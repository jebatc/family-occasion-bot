import { createHash } from "node:crypto";
import { type Db, logMessage } from "./db.ts";

/** One text. waId is the transport's own message id, used to skip redeliveries. mine: sent from this account. */
export type Inbound = { waId: string; from: string; text: string; ts?: number; mine?: boolean };

/** A fingerprint of a text, so the bot can recognize its own messages without keeping their words. */
export const textHash = (text: string) => createHash("sha256").update(text.trim()).digest("hex").slice(0, 32);

/** How the bot reaches people: WhatsApp (Baileys) or the Mac's Messages app (iMessage + SMS). */
export interface Transport {
  name: string;
  /** to: digits with country code, as phoneKey() makes them */
  send(to: string, text: string): Promise<void>;
  /** Posts to a group chat by name; transports without one throw, and announce falls back to individual texts. */
  postToGroup?(groupName: string, text: string): Promise<void>;
  /** True when the bot texts from the host's own number, so it also sees the host's personal texts. */
  sharesHostNumber?: boolean;
  /** Milliseconds to wait between bulk messages: [minimum, extra random] */
  spacing: [number, number];
  /** Starts delivering incoming messages. catchUpSince: when the bot last logged anything. */
  start(onMessage: (m: Inbound) => void, catchUpSince: number): Promise<void>;
}

let active: Transport | undefined;
export const useTransport = (t: Transport | undefined) => void (active = t);
export const transportName = () => active?.name;
export const sharesHostNumber = () => !!active?.sharesHostNumber;

/** DRY_RUN: what would have been sent, in memory only, for simulate and the tests. */
export const dryRunSent: { to: string; text: string }[] = [];

async function deliver(to: string, text: string, how: (t: Transport) => Promise<void>) {
  if (process.env.DRY_RUN) {
    dryRunSent.push({ to, text });
    return console.log(`[dry-run] → ${to}: ${text}`);
  }
  if (!active) throw new Error("No messaging transport is running");
  await how(active);
}

/** Sends a text and logs it in the project's database (with a fingerprint, so its echoes can be recognized). */
export async function sendText(db: Db, to: string, body: string) {
  await deliver(to, body, (t) => t.send(to, body));
  logMessage(db, to, "out", body, undefined, textHash(body));
}

/** Sends a text without logging it anywhere: triage's notices and replies. */
export const sendOnly = (to: string, body: string) => deliver(to, body, (t) => t.send(to, body));

/** True when announce can post to a group chat; otherwise it texts each person. */
export const hasGroup = (groupName: string | undefined) =>
  !!groupName && (process.env.DRY_RUN ? true : !!active?.postToGroup);

export async function postToGroup(db: Db, groupName: string, body: string) {
  await deliver("group", body, (t) => {
    if (!t.postToGroup) throw new Error(`${t.name} can't post to groups`);
    return t.postToGroup(groupName, body);
  });
  logMessage(db, "group", "out", body);
}

// Spread bulk sends out: rapid-fire messages get WhatsApp numbers banned and trip carrier spam filters
export const pause = () => {
  if (process.env.DRY_RUN) return Promise.resolve();
  const [min, extra] = active?.spacing ?? [4000, 6000];
  return new Promise((r) => setTimeout(r, min + Math.random() * extra));
};
