import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { DATA_DIR, findPerson, loadConfig, phoneKey } from "./config.ts";
import { openDb, lastMessageTs } from "./db.ts";
import { ovensText, sendReminders, statusText, tom, snapshotData } from "./agent.ts";
import { triage } from "./triage.ts";
import { acquireLock } from "./lock.ts";
import { notesText } from "./notes.ts";
import { useTransport, sharesHostNumber } from "./transport.ts";
import { whatsapp } from "./whatsapp.ts";
import { imessage, checkMessages } from "./imessage.ts";

const [cmd, ...args] = process.argv.slice(2);
// keys that aren't scoped to a workspace must name one on every request
const claude = () => new Anthropic(process.env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } } : {});
const config = loadConfig();
const db = openDb(join(config.eventDir, "state.db"));
// what the dashboard shows; rewritten while the bot runs
const SNAPSHOT = join(DATA_DIR, "dashboard.json");
const NOTES = join(config.eventDir, "notes-for-next-year.md");
const writeNotes = (path = NOTES) => {
  writeFileSync(path, notesText(loadConfig(), db));
  // One-way copy of the plan files into a Google Drive folder (for Claude Duet etc.); never family.yaml, state.db or .env
  const share = process.env.DRIVE_SHARE_DIR;
  if (share && path === NOTES)
    for (const f of ["event.yaml", "plan.md", "schedule.md", "checklist.md", "notes-for-next-year.md"])
      if (existsSync(join(config.eventDir, f))) copyFileSync(join(config.eventDir, f), join(share, f));
};
const writeSnapshot = (path = SNAPSHOT) => writeFileSync(path, JSON.stringify(snapshotData({ config: loadConfig(), db, client: null as never }), null, 1));

switch (cmd) {
  case "status":
    console.log(statusText(config, db));
    break;

  case "ovens":
    console.log(ovensText(config));
    break;

  case "simulate": {
    process.env.DRY_RUN = "1";
    const [who, ...words] = args;
    const from = who === "host" ? config.host.phone : (findPerson(config, who ?? "")?.phone ?? phoneKey(who ?? ""));
    // roll back afterwards so pretend messages, RSVPs and dish changes never land in the real files
    const eventBefore = readFileSync(config.eventFile);
    db.exec("BEGIN");
    try {
      const ctx = { config, db, client: claude() };
      await triage({ project: tom(ctx), client: ctx.client, shared: false })({ waId: `sim-${Date.now()}`, from, text: words.join(" ") });
    } finally {
      db.exec("ROLLBACK");
      writeFileSync(config.eventFile, eventBefore);
    }
    break;
  }

  case "snapshot":
    writeSnapshot(args[0]);
    console.log(`Wrote ${args[0] ?? SNAPSHOT}`);
    break;

  case "notes":
    writeNotes(args[0]);
    console.log(`Wrote ${args[0] ?? NOTES}`);
    break;

  case "check":
    console.log(await checkMessages());
    break;

  case "serve": {
    if (!acquireLock(join(DATA_DIR, "bot.pid"))) {
      console.error("Another copy of the bot is already running (a terminal, or the background service). Stop it first; two copies answer every text twice.");
      process.exit(0); // clean exit: the background service doesn't restart after one
    }
    const kind = (process.env.TRANSPORT ?? "messages").toLowerCase();
    if (!["messages", "whatsapp"].includes(kind)) throw new Error(`TRANSPORT must be "messages" or "whatsapp", not "${kind}"`);
    const missing = ["ANTHROPIC_API_KEY", ...(kind === "whatsapp" ? ["WA_BOT_PHONE"] : [])].filter((k) => !process.env[k]);
    if (missing.length) throw new Error(`Set these in private/.env: ${missing.join(", ")}`);
    // TEXT_AS=me (default): the bot texts from your own Apple ID; "assistant": it has an Apple ID of its own
    const asMe = (process.env.TEXT_AS ?? "me").toLowerCase() !== "assistant";
    const selfHandles = (process.env.HOST_APPLE_ID ?? "").split(",").map((h) => h.trim()).filter(Boolean);
    const transport = kind === "whatsapp"
      ? whatsapp(join(DATA_DIR, "wa-auth"), phoneKey(process.env.WA_BOT_PHONE!))
      : imessage(asMe ? { host: config.host.phone, selfHandles } : {});
    if (asMe && kind !== "whatsapp") console.log(`Texting as you. Send commands by texting yourself (+${config.host.phone}).`);
    useTransport(transport);
    const ctx = { config, db, client: claude() };
    // every text goes through triage, which refers to Tom only what's his to handle
    const onText = triage({ project: tom(ctx), client: ctx.client, shared: sharesHostNumber() });
    let queue = Promise.resolve(); // one message at a time keeps per-guest history consistent
    await transport.start((msg) => {
      queue = queue
        .then(() => {
          try {
            ctx.config = loadConfig(); // pick up edits to event.yaml, plan.md, etc. without a restart
          } catch (err) {
            console.error("Couldn't reload files, using the last good version:", (err as Error).message);
          }
          return onText(msg);
        })
        .catch((err) => console.error("inbound failed", err));
    }, lastMessageTs(db) ?? Date.now()); // catch up on anything newer than the last message the bot handled
    writeSnapshot();
    writeNotes();
    setInterval(() => { try { writeSnapshot(); writeNotes(); } catch (err) { console.error("snapshot failed", (err as Error).message); } }, 5 * 60_000);
    // daily nudges for missing RSVPs and unconfirmed dishes; checked every 30 minutes, queued with incoming messages
    setInterval(() => {
      queue = queue
        .then(() => { try { ctx.config = loadConfig(); } catch {} return sendReminders(ctx); })
        .catch((err) => console.error("reminders failed", err));
    }, 30 * 60_000);
    break;
  }

  default:
    console.log(`Usage: npm run hc -- <command>
  serve                       start answering texts (TRANSPORT=messages, the default, or whatsapp)
  check                       check the Mac can read and send Messages
  notes [file]                write notes for next year's plan (tasks, supplies, shopping, who was asked; serve keeps them current)
  snapshot [file]             write what the dashboard shows (private/dashboard.json; serve does this every 5 minutes)
  status                      who's coming, who's bringing what, open questions
  ovens                       which dishes go in which oven, in time order
  simulate <name|host> "msg"  run a message through the agent without sending (DRY_RUN)

Sending happens from your phone: text the bot "rsvp", "request", "announce <message>", "status" or "ovens".`);
}
