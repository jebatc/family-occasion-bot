import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Inbound, Transport } from "./transport.ts";

/**
 * The Mac Messages transport: sends through the Messages app (AppleScript) and reads replies from its database.
 * iMessage goes over Apple's servers; SMS goes through an iPhone signed in to the same Apple ID with
 * Text Message Forwarding turned on for this Mac. Needs Full Disk Access (to read chat.db) and permission
 * to control Messages (macOS asks the first time).
 */

export const CHAT_DB = join(homedir(), "Library", "Messages", "chat.db");
const POLL_MS = 3000;
const CATCH_UP_MS = 3 * 24 * 3600 * 1000;
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);

/** Messages stores dates as nanoseconds since 2001 (seconds on very old macOS), too big for JS numbers, so SQL converts them. */
const DATE_MS = "(CASE WHEN m.date > 100000000000 THEN m.date / 1000000 ELSE m.date * 1000 END)";
export const msToAppleDate = (ms: number) => BigInt(Math.round(ms - APPLE_EPOCH_MS)) * 1_000_000n;

/**
 * Newer macOS leaves message.text empty and keeps the text inside attributedBody, an archived NSAttributedString.
 * The string follows the "NSString" class name: 5 bytes of header, then a length (1 byte, or 0x81 + 2 bytes,
 * or 0x82 + 3 bytes, little-endian), then UTF-8.
 */
export function textFromAttributedBody(blob: Uint8Array | null | undefined): string | undefined {
  if (!blob) return;
  const buf = Buffer.from(blob);
  const at = buf.indexOf("NSString");
  if (at < 0) return;
  let i = at + "NSString".length + 5;
  if (i >= buf.length) return;
  let len = buf[i++];
  if (len === 0x81) (len = buf.readUInt16LE(i)), (i += 2);
  else if (len === 0x82) (len = buf.readUIntLE(i, 3)), (i += 3);
  if (i + len > buf.length) return;
  return buf.subarray(i, i + len).toString("utf8");
}

export type ChatRow = {
  rowid: number;
  guid: string;
  text: string | null;
  body: Uint8Array | null;
  date: number; // milliseconds since 2001
  handle: string;
};

/** "+15550000001" → "15550000001"; email handles (iMessage from an Apple ID) are kept as they are. */
const fromHandle = (h: string) => (h.includes("@") ? h.toLowerCase() : h.replace(/\D/g, ""));

export function rowToInbound(r: ChatRow): Inbound | undefined {
  const text = (r.text ?? textFromAttributedBody(r.body))?.replace(/￼/g, "").trim(); // U+FFFC marks an attachment
  if (!text) return;
  return { waId: r.guid, from: fromHandle(r.handle), text, ts: APPLE_EPOCH_MS + r.date };
}

// Incoming one-to-one texts only: no group chats, tapbacks, edits/unsends or our own messages
const INCOMING = `
  SELECT m.ROWID AS rowid, m.guid, m.text, m.attributedBody AS body, ${DATE_MS} AS date, h.id AS handle
  FROM message m JOIN handle h ON h.ROWID = m.handle_id
  WHERE m.is_from_me = 0 AND m.item_type = 0 AND m.associated_message_type = 0
    AND NOT EXISTS (SELECT 1 FROM chat_message_join cmj JOIN chat c ON c.ROWID = cmj.chat_id
                    WHERE cmj.message_id = m.ROWID AND c.style = 43)`;

export function openChatDb(path = CHAT_DB) {
  if (!existsSync(path)) throw new Error(`Can't find ${path}. Is Messages set up on this Mac?`);
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    db.prepare("SELECT 1 FROM message LIMIT 1").get();
    return db;
  } catch (err) {
    throw new Error(`Can't read ${path} (${(err as Error).message}). Give Full Disk Access to the app running the bot ` +
      `(Terminal, and node itself: System Settings → Privacy & Security → Full Disk Access).`);
  }
}

/** Messages that arrived after rowid, plus (on the first call) recent ones newer than since. */
export function newMessages(db: DatabaseSync, afterRowid: number | bigint, since?: number): ChatRow[] {
  if (since !== undefined)
    return db.prepare(`${INCOMING} AND m.date > ? ORDER BY m.ROWID`).all(msToAppleDate(since)) as unknown as ChatRow[];
  return db.prepare(`${INCOMING} AND m.ROWID > ? ORDER BY m.ROWID`).all(afterRowid) as unknown as ChatRow[];
}

const maxRowid = (db: DatabaseSync) => (db.prepare("SELECT COALESCE(MAX(ROWID), 0) AS n FROM message").get()!.n as number);

/** iMessage or SMS for this person: whatever Messages last used with them, else iMessage. */
export function serviceFor(db: DatabaseSync, handle: string): "iMessage" | "SMS" {
  const row = db.prepare(`
    SELECT c.service_name AS s FROM chat c JOIN chat_handle_join chj ON chj.chat_id = c.ROWID JOIN handle h ON h.ROWID = chj.handle_id
    WHERE h.id = ? AND c.style = 45 ORDER BY c.ROWID DESC LIMIT 1`).get(handle);
  return row?.s === "SMS" ? "SMS" : "iMessage";
}

// Text and recipient travel as arguments, never inside the script, so nothing in a message can run as AppleScript
const SEND_SCRIPT = `
on run argv
  set theHandle to item 1 of argv
  set theText to item 2 of argv
  set theService to item 3 of argv
  tell application "Messages"
    if theService is "SMS" then
      set acct to 1st account whose service type = SMS
    else
      set acct to 1st account whose service type = iMessage
    end if
    send theText to participant theHandle of acct
  end tell
end run`;

const GROUP_SCRIPT = `
on run argv
  set theName to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    set matches to (every chat whose name is theName)
    if (count of matches) is 0 then error "No Messages group chat named " & quoted form of theName
    send theText to item 1 of matches
  end tell
end run`;

export type RunScript = (script: string, args: string[]) => Promise<string>;
const osascript: RunScript = (script, args) =>
  new Promise((resolve, reject) =>
    execFile("osascript", ["-e", script, ...args], { timeout: 30_000 }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout)));

/** Did Messages mark the first message we sent this person after rowid as failed? (iMessage to a non-iPhone does that.) */
export function sendFailed(db: DatabaseSync, handle: string, afterRowid: number) {
  const row = db.prepare(`
    SELECT m.error FROM message m JOIN handle h ON h.ROWID = m.handle_id
    WHERE h.id = ? AND m.is_from_me = 1 AND m.ROWID > ? ORDER BY m.ROWID LIMIT 1`).get(handle, afterRowid);
  return !!row && Number(row.error) !== 0;
}

export function imessage(opts: { chatDb?: string; run?: RunScript; failCheckMs?: number } = {}): Transport {
  const run = opts.run ?? osascript;
  let db: DatabaseSync | undefined;
  const chat = () => (db ??= openChatDb(opts.chatDb));
  const handleFor = (to: string) => (to.includes("@") ? to : `+${to}`);

  return {
    name: "Messages",
    spacing: [1500, 2500], // no ban risk, but carriers filter bursts of identical texts
    async send(to, text) {
      const handle = handleFor(to);
      const service = serviceFor(chat(), handle);
      const before = maxRowid(chat());
      await run(SEND_SCRIPT, [handle, text, service]);
      // iMessage to someone who isn't on iMessage fails a few seconds later; send it again as SMS
      if (service === "iMessage" && !handle.includes("@"))
        setTimeout(() => {
          if (!sendFailed(chat(), handle, before)) return;
          console.log(`iMessage to ${handle} failed, sending as SMS instead.`);
          run(SEND_SCRIPT, [handle, text, "SMS"]).catch((err) => console.error(`SMS to ${handle} failed too:`, err.message));
        }, opts.failCheckMs ?? 15_000);
    },
    postToGroup: (groupName, text) => run(GROUP_SCRIPT, [groupName, text]).then(() => {}),
    async start(onMessage, catchUpSince) {
      const d = chat();
      let after = maxRowid(d);
      // catch up on recent messages that arrived while the bot was off; already-answered ones are skipped by guid
      const since = Math.max(catchUpSince, Date.now() - CATCH_UP_MS);
      const missed = newMessages(d, 0, since).map(rowToInbound).filter((m): m is Inbound => !!m);
      if (missed.length) console.log(`${new Date().toLocaleTimeString()} Catching up on ${missed.length} message(s) that arrived while offline.`);
      missed.forEach(onMessage);
      console.log(`${new Date().toLocaleTimeString()} Messages connected. Listening for texts.`);
      setInterval(() => {
        try {
          const rows = newMessages(d, after);
          for (const r of rows) {
            after = r.rowid;
            const m = rowToInbound(r);
            if (m) onMessage(m);
          }
        } catch (err) {
          console.error("Couldn't read new messages:", (err as Error).message);
        }
      }, POLL_MS);
    },
  };
}

/** Setup check: can we read chat.db, and which Messages accounts are signed in? */
export async function checkMessages(run: RunScript = osascript) {
  const lines: string[] = [];
  try {
    const d = openChatDb();
    lines.push(`✅ Can read Messages history (${maxRowid(d)} messages).`);
  } catch (err) {
    lines.push(`❌ ${(err as Error).message}`);
  }
  try {
    const out = await run(`tell application "Messages" to get service type of every account`, []);
    const types = out.trim();
    lines.push(`✅ Can control Messages. Accounts: ${types || "none"}.`);
    if (!/SMS/.test(types)) lines.push("⚠️ No SMS account: relatives without iPhones won't get texts. On the iPhone: Settings → Apps → Messages → Text Message Forwarding → turn on this Mac.");
  } catch (err) {
    lines.push(`❌ Can't control Messages (${(err as Error).message}). Allow it under System Settings → Privacy & Security → Automation.`);
  }
  return lines.join("\n");
}
