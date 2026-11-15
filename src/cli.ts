import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { DATA_DIR, loadConfig, phoneKey } from "./config.ts";
import { openDb, lastMessageTs } from "./db.ts";
import { handleInbound, ovensText, sendReminders, statusText } from "./agent.ts";
import { connect } from "./whatsapp.ts";

const [cmd, ...args] = process.argv.slice(2);
// keys that aren't scoped to a workspace must name one on every request
const claude = () => new Anthropic(process.env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } } : {});
const config = loadConfig();
const db = openDb(join(config.eventDir, "state.db"));

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
    const from = who === "host" ? config.host.phone : (config.people.find((p) => p.name === who)?.phone ?? phoneKey(who ?? ""));
    // roll back afterwards so pretend messages, RSVPs and dish changes never land in the real files
    const eventBefore = readFileSync(config.eventFile);
    db.exec("BEGIN");
    try {
      await handleInbound({ config, db, client: claude() }, { waId: `sim-${Date.now()}`, from, text: words.join(" ") });
    } finally {
      db.exec("ROLLBACK");
      writeFileSync(config.eventFile, eventBefore);
    }
    break;
  }

  case "serve": {
    const missing = ["ANTHROPIC_API_KEY", "WA_BOT_PHONE"].filter((k) => !process.env[k]);
    if (missing.length) throw new Error(`Set these in private/.env: ${missing.join(", ")}`);
    const ctx = { config, db, client: claude() };
    let queue = Promise.resolve(); // one message at a time keeps per-guest history consistent
    await connect(join(DATA_DIR, "wa-auth"), phoneKey(process.env.WA_BOT_PHONE!), (msg) => {
      queue = queue
        .then(() => {
          try {
            ctx.config = loadConfig(); // pick up edits to event.yaml, plan.md, etc. without a restart
          } catch (err) {
            console.error("Couldn't reload files, using the last good version:", (err as Error).message);
          }
          return handleInbound(ctx, msg);
        })
        .catch((err) => console.error("inbound failed", err));
    }, lastMessageTs(db) ?? Date.now()); // catch up on anything newer than the last message the bot handled
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
  serve                       link the bot's WhatsApp number and start answering
  status                      who's coming, who's bringing what, open questions
  ovens                       which dishes go in which oven, in time order
  simulate <name|host> "msg"  run a message through the agent without sending (DRY_RUN)

Sending happens from your phone: text the bot "rsvp", "request", "announce <message>", "status" or "ovens".`);
}
