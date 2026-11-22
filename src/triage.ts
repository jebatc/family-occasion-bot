import type Anthropic from "@anthropic-ai/sdk";
import { phoneKey } from "./config.ts";
import { LIMITS, clip, screenMessage } from "./guard.ts";
import { type Inbound, sendOnly, textHash } from "./transport.ts";

/**
 * Triage: the standalone agent every incoming text goes through first. It decides who a text is from, whether it's
 * about a project, and whether the host is busy talking with that person, then refers only what a project should
 * handle. It stores nothing: what it turns away leaves no trace, and the little it remembers (texts already seen,
 * hourly counts, when the host last texted someone) lives in memory only.
 *
 * A project is anything that wants texts referred to it. Tom is one; a follow-up agent could be another.
 */
export interface Project {
  name: string;
  hostPhone(): string;
  hostName(): string;
  /** The people this project knows; texts from anyone else are never screened for it. */
  person(phone: string): { name: string } | undefined;
  /** Is it waiting on this person? On the host's own number, texts from others aren't even screened. */
  listeningTo(phone: string): boolean;
  /** The project's recent conversation with this person, for the screener's context. */
  conversation(phone: string): { direction: string; body: string }[];
  /** Did the project send this text (by fingerprint) to this number? Tells its own texts from the host's. */
  sent(phone: string, hash: string): boolean;
  /** The reply to an off-topic text, when the project has a number of its own. */
  offTopicReply(): string;
  /** A text referred to the project: a command from the host, or a relevant text from someone it knows. */
  handle(r: Referral): Promise<void>;
}

/**
 * fromHost: a command from the host. quiet: the host is texting this person personally right now, so the project
 * should record what they say but leave the replying to the host.
 */
export type Referral = { waId: string; from: string; text: string; ts?: number; fromHost?: boolean; quiet?: boolean };

/** When the bot texts from the host's own number: how long after the host texts someone personally it stays out of it. */
export const HANDOFF_MS = 30 * 60_000;

/** Kept in memory only, for as long as the process runs. */
export type TriageState = { seen: Set<string>; hostTexted: Map<string, number>; recent: Map<string, number[]> };
export const newTriageState = (): TriageState => ({ seen: new Set(), hostTexted: new Map(), recent: new Map() });

/** shared: the bot texts from the host's own number, so it also sees the host's personal texts. */
export function triage(opts: { project: Project; client: Anthropic; shared: boolean; state?: TriageState }) {
  const { project, client, shared } = opts;
  const state = opts.state ?? newTriageState();
  const tellHost = (text: string) => sendOnly(project.hostPhone(), text); // not stored anywhere

  /** Counts this person's texts in the last hour; true once they're over the limit. */
  const overLimit = (phone: string, now: number) => {
    const times = (state.recent.get(phone) ?? []).filter((t) => now - t < 3600_000);
    times.push(now);
    state.recent.set(phone, times);
    return times.length;
  };

  return async function onText(msg: Inbound) {
    if (!msg.waId || state.seen.has(msg.waId)) return; // redelivered
    state.seen.add(msg.waId);
    const now = Date.now();
    const from = phoneKey(msg.from);
    const host = project.hostPhone();

    if (msg.mine) {
      // the host texting someone personally: only when matters, so the project can step back; never the words
      if (shared && !(msg.hash && project.sent(from, msg.hash))) state.hostTexted.set(from, msg.ts ?? now);
      return;
    }
    if (from === host) {
      // the project's replies to the host land in the host's chat with themselves; skip them
      if (shared && project.sent(host, textHash(msg.text))) return;
      return project.handle({ waId: msg.waId, from, text: msg.text, ts: msg.ts, fromHost: true });
    }

    const person = project.person(from);
    if (!person) {
      // on the host's own number, strangers are the host's business
      if (!shared) await tellHost(`Message from unknown ${from ? `number +${from}` : msg.from}: ${msg.text}`);
      return;
    }
    if (shared && !project.listeningTo(from)) return; // not a conversation the project is in: never read
    // on the host's own number they already see the text in their thread, so notices don't repeat it
    const quote = (n = LIMITS.field) => (shared ? "" : `: "${clip(msg.text, n)}"`);

    const count = overLimit(from, now);
    if (count > LIMITS.messagesPerHour) {
      if (count === LIMITS.messagesPerHour + 1)
        await tellHost(`⚠️ ${person.name} has sent over ${LIMITS.messagesPerHour} messages this hour, so I've paused auto-replies to them for now${quote(200)}`);
      return;
    }

    let verdict, reason;
    try {
      const history = [...project.conversation(from), { direction: "in", body: msg.text }];
      ({ verdict, reason } = await screenMessage(client, person, history, shared ? project.hostName() : undefined));
    } catch (err) {
      console.error(`screening failed for ${person.name}`, (err as Error).message);
      return tellHost(`⚠️ I couldn't check a message from ${person.name}${quote()}, so I haven't answered it. Please reply to them directly.`);
    }
    if (verdict === "off_topic") return shared ? undefined : sendOnly(from, project.offTopicReply());
    if (verdict === "suspicious")
      return tellHost(`⚠️ Held a message from ${person.name} without replying (${clip(reason, 150)})${shared ? ". It's in your thread with them." : `:\n"${clip(msg.text)}"`}\nIf it needs an answer: tell ${person.name.split(" ")[0]}: <your message>`);

    const talking = shared && now - (state.hostTexted.get(from) ?? 0) < HANDOFF_MS;
    return project.handle({ waId: msg.waId, from, text: msg.text, ts: msg.ts, ...(talking ? { quiet: true } : {}) });
  };
}
