import makeWASocket, {
  DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, isJidGroup, isPnUser, jidDecode,
  type WASocket, type WAMessage,
} from "baileys";
import pino from "pino";
import { type Db, logMessage } from "./db.ts";

let sock: WASocket | undefined;
let drops = 0; // consecutive drops since the last successful connection

async function send(jid: string, text: string) {
  if (process.env.DRY_RUN) return console.log(`[dry-run] → ${jid}: ${text}`);
  if (!sock) throw new Error("WhatsApp isn't connected");
  await sock.sendMessage(jid, { text });
}

// Messages to the same person are spaced out, so a follow-up never lands right after the one before it
const lastSent = new Map<string, number>();
const gapMs = () => Number(process.env.MESSAGE_GAP_MS ?? 5 * 60_000);

async function pace(to: string) {
  const wait = (lastSent.get(to) ?? 0) + gapMs() - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSent.set(to, Date.now());
}

export async function sendText(db: Db, to: string, body: string) {
  await pace(to);
  await send(`${to}@s.whatsapp.net`, body);
  logMessage(db, to, "out", body);
}

/** Posts to a group: the one a message came from (jid), or else the family group by name. */
export async function postToGroup(db: Db, groupName: string, body: string, jid?: string) {
  let target = jid ?? "dry-run-group";
  if (!jid && !process.env.DRY_RUN) {
    const groups = Object.values(await sock!.groupFetchAllParticipating());
    const group = groups.find((g) => g.subject.trim().toLowerCase() === groupName.trim().toLowerCase());
    if (!group) throw new Error(`The bot isn't in a group named "${groupName}"`);
    target = group.id;
  }
  await send(target, body);
  logMessage(db, "group", "out", body);
}

// Spread bulk sends out: rapid-fire messages from an unofficial client are what gets numbers banned
export const pause = () => new Promise((r) => setTimeout(r, process.env.DRY_RUN ? 0 : 4000 + Math.random() * 6000));

export type Inbound = { waId: string; from: string; text: string; ts?: number; group?: string }; // group: the group's id, when it came from one

const CATCH_UP_MS = 3 * 24 * 3600 * 1000;

/** A message WhatsApp delivered as catch-up ("append") is answered only if it arrived after the bot last logged anything, and recently. */
export const worthCatchingUp = (msg: Inbound, since: number, now = Date.now()) =>
  !!msg.ts && msg.ts > since && now - msg.ts < CATCH_UP_MS;

/** Text DMs only; groups, our own messages and non-text (reactions, media, receipts) are ignored. */
export function toInbound(m: WAMessage): Inbound | undefined {
  const { key } = m;
  if (key.fromMe || !key.remoteJid) return;
  const group = isJidGroup(key.remoteJid);
  if (group && !key.participant) return;
  const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text;
  if (!text || !key.id) return;
  // WhatsApp may address senders by a private "lid"; the phone-number jid is then in remoteJidAlt
  // in a group the sender is the participant; either id may be a private "lid" with the phone number alongside
  const ids = group ? [key.participant!, key.participantAlt] : [key.remoteJid, key.remoteJidAlt];
  const pn = ids.find((j) => j && isPnUser(j));
  const t = m.messageTimestamp as number | { toNumber(): number } | null | undefined;
  const secs = typeof t === "number" ? t : t?.toNumber();
  return { waId: key.id, from: jidDecode(pn ?? ids[0]!)!.user, text, ...(secs ? { ts: secs * 1000 } : {}), ...(group ? { group: key.remoteJid! } : {}) };
}

// libsignal (inside Baileys) dumps encryption session keys via console.info/warn on routine key rotation
console.info = () => {};
const warn = console.warn;
console.warn = (...args: unknown[]) => void (/^Session already/.test(String(args[0])) || warn(...args));

/** catchUpSince: when the bot last logged a message; catch-up messages newer than that get answered. */
export async function connect(authDir: string, botPhone: string, onMessage: (m: Inbound) => void, catchUpSince = Date.now()) {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  // an outdated WhatsApp Web version is a common cause of connections that keep dropping
  const version = await fetchLatestBaileysVersion().then((v) => v.version).catch(() => undefined);
  sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }), ...(version ? { version } : {}) });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr && !state.creds.registered) {
      const code = await sock!.requestPairingCode(botPhone);
      console.log(`\nOn the spare phone: WhatsApp → Settings → Linked devices → Link a device → "Link with phone number instead", then enter:\n\n    ${code}\n`);
    }
    const at = new Date().toLocaleTimeString();
    if (connection === "open") {
      drops = 0;
      console.log(`${at} WhatsApp connected. Listening for messages.`);
    }
    if (connection === "close") {
      const status = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      const why = `${status ?? "?"} ${DisconnectReason[status as number] ?? lastDisconnect?.error?.message ?? ""}`.trim();
      if (status === DisconnectReason.loggedOut) {
        console.error(`${at} Logged out (${why}). Delete ${authDir} and run serve again to re-link.`);
        process.exit(0); // exit cleanly so the background service doesn't keep restarting; this needs a person
      }
      if (status === DisconnectReason.connectionReplaced) {
        console.error(`${at} Another copy of the bot (or another WhatsApp Web session using this login) took over (${why}). Stop the other one, then run serve again.`);
        process.exit(0); // exit cleanly so the background service doesn't fight the other copy
      }
      // restartRequired is a normal step right after linking; otherwise back off 2s, 4s, 8s… up to a minute
      const wait = status === DisconnectReason.restartRequired ? 0 : Math.min(60_000, 2000 * 2 ** drops++);
      console.log(`${at} Connection dropped (${why}), reconnecting in ${wait / 1000}s…`);
      setTimeout(() => connect(authDir, botPhone, onMessage, catchUpSince), wait);
    }
  });
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    // "notify" is new; "append" mixes old chat history with messages that arrived while the bot was off
    const inbound = messages.map(toInbound).filter((m): m is Inbound => !!m)
      .filter((m) => type === "notify" || worthCatchingUp(m, catchUpSince));
    if (type !== "notify" && inbound.length) console.log(`${new Date().toLocaleTimeString()} Catching up on ${inbound.length} message(s) that arrived while offline.`);
    inbound.forEach(onMessage); // already-answered ones are skipped by their WhatsApp message id
  });
}
