// Sends the Thanksgiving greeting (the card, with the greeting written on it) to everyone in private/friends.yaml.
// Each person gets their own text thread (never a group chat); iMessage falls back to SMS per person.
// Usage: node scripts/send-greeting.ts [--dry-run] [--now]
//   --dry-run  print who would get what, send nothing
//   --now      skip the "is it Thanksgiving?" date check (for testing)
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { CHAT_DB, openChatDb, sendPhoto, serviceFor } from "../src/imessage.ts";

const ROOT = join(import.meta.dirname, "..");
const SOURCE = join(ROOT, "private", "greeting-card-captioned.jpg"); // made by scripts/caption-card.py: the greeting is written on the card
const IMAGE = join(homedir(), "Pictures", "tom", "greeting-card.jpg"); // Messages only attaches files from here (not the project folder)
const THANKSGIVING = "2026-11-26"; // fourth Thursday of November 2026

const SENT = join(ROOT, "private", `greeting-sent-${THANKSGIVING}.txt`); // one handle per line; a rerun skips these
const alreadySent = new Set(existsSync(SENT) ? readFileSync(SENT, "utf8").split("\n").filter(Boolean) : []);

const args = new Set(process.argv.slice(2));
const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
if (!args.has("--now") && today !== THANKSGIVING) {
  console.log(`Not Thanksgiving (today is ${today}). Nothing sent.`);
  process.exit(0);
}

const friends: { name: string; phone: string }[] = parse(readFileSync(join(ROOT, "private", "friends.yaml"), "utf8")).friends;
if (!existsSync(SOURCE)) throw new Error(`Missing card image: ${SOURCE}`);
mkdirSync(join(IMAGE, ".."), { recursive: true });
copyFileSync(SOURCE, IMAGE);

const dry = args.has("--dry-run");
const db = dry ? undefined : openChatDb(CHAT_DB);
const handleFor = (phone: string) => `+${phone.replace(/\D/g, "")}`;

for (const f of friends) {
  const handle = handleFor(f.phone);
  if (alreadySent.has(handle)) {
    console.log(`skipped ${f.name} (already sent)`);
    continue;
  }
  const service = db ? serviceFor(db, handle) : "auto";
  if (dry) {
    console.log(`would send to ${f.name} (${handle}, ${service}): the card`);
    continue;
  }
  try {
    const used = await sendPhoto(db!, handle, IMAGE, service as "iMessage" | "SMS");
    appendFileSync(SENT, handle + "\n"); // record right away so a crash or rerun can't double-send
    console.log(`sent to ${f.name} (picture via ${used})`);
  } catch (err) {
    console.error(`failed for ${f.name}:`, (err as Error).message);
  }
  await new Promise((r) => setTimeout(r, 3_000)); // pacing, as the bot does
}
