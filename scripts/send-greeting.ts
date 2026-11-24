// Sends the Thanksgiving greeting (text + card image) to everyone in private/friends.yaml.
// Each person gets their own text thread (never a group chat); iMessage falls back to SMS per person.
// Usage: node scripts/send-greeting.ts [--dry-run] [--now]
//   --dry-run  print who would get what, send nothing
//   --now      skip the "is it Thanksgiving?" date check (for testing)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { CHAT_DB, imessage, openChatDb, sendPhoto, serviceFor } from "../src/imessage.ts";

const ROOT = join(import.meta.dirname, "..");
const IMAGE = join(ROOT, "private", "greeting-card.jpg");
const TEXT = "Happy Thanksgiving!\n\n-Tom the Turkey 🦃 (Jenn's Thanksgiving Agent)";
const THANKSGIVING = "2026-11-26"; // fourth Thursday of November 2026

const args = new Set(process.argv.slice(2));
const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
if (!args.has("--now") && today !== THANKSGIVING) {
  console.log(`Not Thanksgiving (today is ${today}). Nothing sent.`);
  process.exit(0);
}

const friends: { name: string; phone: string }[] = parse(readFileSync(join(ROOT, "private", "friends.yaml"), "utf8")).friends;
if (!existsSync(IMAGE)) throw new Error(`Missing card image: ${IMAGE}`);

const dry = args.has("--dry-run");
const db = dry ? undefined : openChatDb(CHAT_DB);
const transport = imessage();
const handleFor = (phone: string) => `+${phone.replace(/\D/g, "")}`;

for (const f of friends) {
  const handle = handleFor(f.phone);
  const service = db ? serviceFor(db, handle) : "auto";
  if (dry) {
    console.log(`would send to ${f.name} (${handle}, ${service}): "${TEXT}" + card image`);
    continue;
  }
  try {
    await transport.send(f.phone.replace(/\D/g, ""), TEXT); // transport.send already falls back to SMS for the text
    await new Promise((r) => setTimeout(r, 2_000)); // keep the text and the picture apart
    const used = await sendPhoto(db!, handle, IMAGE, service as "iMessage" | "SMS");
    console.log(`sent to ${f.name} (picture via ${used})`);
  } catch (err) {
    console.error(`failed for ${f.name}:`, (err as Error).message);
  }
  await new Promise((r) => setTimeout(r, 3_000)); // pacing, as the bot does
}
