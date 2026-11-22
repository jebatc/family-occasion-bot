import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, wa_id TEXT UNIQUE, phone TEXT NOT NULL,
      direction TEXT NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rsvps (phone TEXT PRIMARY KEY, status TEXT NOT NULL, headcount INTEGER,
      note TEXT, ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS escalations (id INTEGER PRIMARY KEY, phone TEXT NOT NULL, question TEXT NOT NULL,
      suggested TEXT, answer TEXT, status TEXT NOT NULL DEFAULT 'open', ts INTEGER NOT NULL, dish TEXT);
    CREATE TABLE IF NOT EXISTS changes (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, phone TEXT NOT NULL,
      action TEXT NOT NULL, detail TEXT NOT NULL);
  `);
  // Databases created before dish proposals lack the column
  if (!db.prepare("SELECT 1 FROM pragma_table_info('escalations') WHERE name = 'dish'").get()) db.exec("ALTER TABLE escalations ADD COLUMN dish TEXT");
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'hash'").get()) db.exec("ALTER TABLE messages ADD COLUMN hash TEXT");
  return db;
}

/** Clears stored words of texts to the host (they can quote messages triage turned away). */
export function scrubStoredText(db: Db, hostPhone: string) {
  db.prepare("UPDATE messages SET body = '' WHERE phone IN (?, 'group') AND body != ''").run(hostPhone);
}

/** Triage passed this message to the bot, so its words may now be kept. */
export function keepText(db: Db, waId: string, body: string) {
  db.prepare("UPDATE messages SET body = ? WHERE wa_id = ? AND direction = 'in'").run(body, waId);
}

/** Clears every stored word of every message and question; RSVPs and the plan are kept. */
export function forgetAllText(db: Db) {
  db.exec("UPDATE messages SET body = ''; UPDATE escalations SET question = '', suggested = NULL, answer = NULL; UPDATE changes SET detail = '' WHERE action = 'held_message'");
}

/**
 * Records that a message happened. Returns false when this message id was already logged (redeliveries).
 * body is stored as given, so callers pass "" for anything whose words shouldn't be kept.
 */
export function logMessage(db: Db, phone: string, direction: "in" | "out", body: string, waId?: string, hash?: string) {
  const r = db
    .prepare("INSERT OR IGNORE INTO messages (wa_id, phone, direction, body, ts, hash) VALUES (?, ?, ?, ?, ?, ?)")
    .run(waId ?? null, phone, direction, body, Date.now(), hash ?? null);
  return r.changes > 0;
}

/** Audit trail of every change a guest's message made to the plan. */
export function logChange(db: Db, phone: string, action: string, detail: string) {
  db.prepare("INSERT INTO changes (ts, phone, action, detail) VALUES (?, ?, ?, ?)").run(Date.now(), phone, action, detail);
}

export function lastMessageTs(db: Db): number | undefined {
  return (db.prepare("SELECT MAX(ts) AS ts FROM messages").get()?.ts as number | null) ?? undefined;
}

export function lastInboundTs(db: Db, phone: string): number | undefined {
  const row = db.prepare("SELECT MAX(ts) AS ts FROM messages WHERE phone = ? AND direction = 'in'").get(phone);
  return (row?.ts as number | null) ?? undefined;
}
