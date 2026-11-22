import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  msToAppleDate, textFromAttributedBody, rowToInbound, newMessages, serviceFor, sendFailed, imessage, inboundFilter,
} from "../src/imessage.ts";
import type { Inbound } from "../src/transport.ts";

// A cut-down chat.db with the tables and columns the bot reads, laid out as macOS has them
let path: string;
let chat: DatabaseSync;
let nextId = 1;
beforeEach(() => {
  nextId = 1;
  path = join(mkdtempSync(join(tmpdir(), "hc-chat-")), "chat.db");
  chat = new DatabaseSync(path);
  chat.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB, date INTEGER,
      handle_id INTEGER, is_from_me INTEGER DEFAULT 0, item_type INTEGER DEFAULT 0, associated_message_type INTEGER DEFAULT 0,
      error INTEGER DEFAULT 0);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, style INTEGER, service_name TEXT, display_name TEXT);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
    INSERT INTO handle VALUES (1, '+15550000001', 'iMessage'), (2, '+15550000002', 'SMS'), (3, 'robin@example.com', 'iMessage');
    INSERT INTO chat VALUES (1, 45, 'iMessage', NULL), (2, 45, 'SMS', NULL), (3, 43, 'iMessage', 'Family'), (4, 45, 'iMessage', NULL);
    INSERT INTO chat_handle_join VALUES (1, 1), (2, 2), (3, 1), (3, 2);
  `);
});

function addMessage(m: { handle: number; text?: string | null; body?: Uint8Array; at?: number; fromMe?: boolean; chat?: number; tapback?: boolean; error?: number }) {
  const id = nextId++;
  chat.prepare("INSERT INTO message (ROWID, guid, text, attributedBody, date, handle_id, is_from_me, associated_message_type, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, `guid-${id}`, m.text === undefined ? "hi" : m.text, m.body ?? null, msToAppleDate(m.at ?? Date.now()), m.handle, m.fromMe ? 1 : 0, m.tapback ? 2000 : 0, m.error ?? 0);
  chat.prepare("INSERT INTO chat_message_join VALUES (?, ?)").run(m.chat ?? m.handle, id);
  return id;
}

// What newer macOS stores in attributedBody: an archived NSAttributedString holding the text after "NSString"
function attributedBody(text: string) {
  const utf8 = Buffer.from(text, "utf8");
  const len = utf8.length < 0x80 ? Buffer.from([utf8.length]) : Buffer.concat([Buffer.from([0x81]), Buffer.from([utf8.length & 0xff, utf8.length >> 8])]);
  return Buffer.concat([Buffer.from("\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString", "latin1"),
    Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]), len, utf8, Buffer.from([0x86, 0x84, 0x02, 0x69, 0x49])]);
}

test("Apple dates are read as JS times", () => {
  const at = Date.UTC(2026, 10, 26, 15, 0, 0);
  addMessage({ handle: 1, at });
  assert.equal(rowToInbound(newMessages(chat, 0)[0])?.ts, at);
});

test("text is read from attributedBody when message.text is empty", () => {
  assert.equal(textFromAttributedBody(attributedBody("YES! We'll bring pie 🥧")), "YES! We'll bring pie 🥧");
  const long = "a".repeat(300);
  assert.equal(textFromAttributedBody(attributedBody(long)), long);
  assert.equal(textFromAttributedBody(Buffer.from("nothing here")), undefined);
  assert.equal(textFromAttributedBody(null), undefined);
});

test("only incoming one-to-one texts become messages", () => {
  addMessage({ handle: 1, text: "Yes we're coming" });
  addMessage({ handle: 2, text: null, body: attributedBody("Can I bring Dana?") });
  addMessage({ handle: 1, fromMe: true, text: "Gobble gobble" });
  addMessage({ handle: 1, chat: 3, text: "group chatter" });
  addMessage({ handle: 1, tapback: true, text: "Loved “Gobble gobble”" });
  addMessage({ handle: 3, chat: 4, text: "from an Apple ID email" });
  addMessage({ handle: 1, text: "￼" }); // a photo with no words
  const all = newMessages(chat, 0).map(rowToInbound).filter(Boolean) as Inbound[];
  assert.deepEqual(all.filter((m) => m.mine).map((m) => m.text), ["Gobble gobble"], "sent texts are marked mine");
  const got = all.filter((m) => !m.mine);
  assert.deepEqual(got.map((m) => [m.from, m.text]), [
    ["15550000001", "Yes we're coming"],
    ["15550000002", "Can I bring Dana?"],
    ["robin@example.com", "from an Apple ID email"],
  ]);
  assert.equal(got[0].waId, "guid-1");
});

test("catch-up finds recent messages by date; polling finds new ones by row", () => {
  const now = Date.now();
  addMessage({ handle: 1, text: "old", at: now - 5 * 3600_000 });
  const recent = addMessage({ handle: 1, text: "while you were out", at: now - 3600_000 });
  assert.deepEqual(newMessages(chat, 0, now - 2 * 3600_000).map((r) => r.text), ["while you were out"]);
  addMessage({ handle: 2, text: "new" });
  assert.deepEqual(newMessages(chat, recent).map((r) => r.text), ["new"]);
});

test("replies go out on the service Messages last used with that person", () => {
  assert.equal(serviceFor(chat, "+15550000001"), "iMessage");
  assert.equal(serviceFor(chat, "+15550000002"), "SMS");
  assert.equal(serviceFor(chat, "+15559999999"), "iMessage", "new people are tried on iMessage first");
});

test("send passes the text as an argument and falls back to SMS when iMessage fails", async () => {
  const calls: string[][] = [];
  const t = imessage({ chatDb: path, failCheckMs: 10, run: async (_script, args) => {
    calls.push(args);
    if (args[2] === "iMessage") addMessage({ handle: 1, fromMe: true, text: args[1], error: 22 }); // not on iMessage
    return "";
  } });
  await t.send("15550000001", 'Hi "Sue" & co'); // quotes can't break out of the script
  assert.deepEqual(calls[0], ["+15550000001", 'Hi "Sue" & co', "iMessage"]);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(calls[1], ["+15550000001", 'Hi "Sue" & co', "SMS"]);

  await t.send("15550000002", "Hi Bob");
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(calls.slice(2), [["+15550000002", "Hi Bob", "SMS"]], "SMS people get SMS straight away, once");
});

test("a delivered iMessage isn't resent", () => {
  const before = Number(chat.prepare("SELECT MAX(ROWID) AS n FROM message").get()?.n ?? 0);
  addMessage({ handle: 1, fromMe: true, text: "ok" });
  assert.equal(sendFailed(chat, "+15550000001", before), false);
  addMessage({ handle: 1, fromMe: true, text: "later one failed", error: 22 });
  assert.equal(sendFailed(chat, "+15550000001", before), false, "only the message just sent counts");
});

const HOST = "15550000000";
const msg = (from: string, text: string, extra: Partial<Inbound> = {}): Inbound => ({ waId: `g-${Math.random()}`, from, text, ts: Date.now(), ...extra });

test("on its own Apple ID, the bot ignores everything it sent", () => {
  const { accept } = inboundFilter({});
  assert.equal(accept(msg("15550000001", "hi", { mine: true })), undefined);
  assert.equal(accept(msg("15550000001", "hi"))?.text, "hi");
});

test("texting as you: your texts to yourself are commands, acted on once", () => {
  const { accept } = inboundFilter({ host: HOST, selfHandles: ["Me@Example.com"] });
  const cmd = accept(msg(HOST, "status", { mine: true }));
  assert.deepEqual([cmd?.from, cmd?.text, cmd?.mine], [HOST, "status", undefined]);
  assert.equal(accept(msg(HOST, "status")), undefined, "the received copy of a text to yourself");
  assert.equal(accept(msg("me@example.com", "rsvp", { mine: true }))?.from, HOST, "self-chat on your Apple ID email");
});

test("texting as you: the bot's own texts aren't mistaken for yours", () => {
  const { accept, remember } = inboundFilter({ host: HOST });
  remember("+15550000001", "Gobble gobble! — Tom 🦃");
  remember(`+${HOST}`, "Sent to Aunt Sue.");
  assert.equal(accept(msg("15550000001", "Gobble gobble! — Tom 🦃", { mine: true })), undefined);
  assert.equal(accept(msg(HOST, "Sent to Aunt Sue.", { mine: true })), undefined);
  assert.equal(accept(msg(HOST, "Sent to Aunt Sue.")), undefined);
  const yours = accept(msg("15550000001", "See you Thursday!", { mine: true }));
  assert.deepEqual([yours?.mine, yours?.text], [true, ""], "what you typed yourself arrives with no words");
  assert.equal(yours?.hash?.length, 32);
  assert.equal(accept(msg("15550000001", "Can't wait"))?.text, "Can't wait");
});
