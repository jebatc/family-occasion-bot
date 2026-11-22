import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse, parseDocument, YAMLMap, YAMLSeq } from "yaml";

export const DATA_DIR = resolve(process.env.HOLIDAY_DATA_DIR ?? "private");
const envFile = join(DATA_DIR, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export type Person = { name: string; phone: string; household: string; dietary?: string; notes?: string };
/** One menu entry in event.yaml. plan = needed up front; shopping, prep_ahead and day_of = needed when executing. */
export type Dish = {
  dish: string; // short name, e.g. "Brussels sprout salad"
  description?: string; // the specifics, e.g. "salt-wilted, with tangerine, pecans and goat cheese"; included when asking the owner
  quantity?: number | string; // e.g. 2 pecan pies
  course?: string; // appetizer, main, side, dessert, drink, or "task" for a day-of job (not something to bring)
  owner?: string | string[] | null; // a name from family.yaml (or the host), or a list for shared tasks; empty = needs an owner
  status?: "proposed" | "requested" | "confirmed" | "done"; // proposed = not asked yet; requested = asked; confirmed = owner said yes; done = an errand finished
  done_by?: string; // makes it an errand to finish before the day, e.g. "Wednesday, November 25"; Tom nudges until it's done
  confirmation?: string; // when and how the owner confirmed
  declined_by?: string; // last person who said no; the dish goes back to proposed with no owner
  fallback?: string; // who takes it if the owner says no (instead of leaving it unowned)
  confirm_on_rsvp?: boolean; // never asked about; becomes Confirmed when the owner's household RSVPs yes
  ask_as?: string; // how the dish is named when asking its owner (replaces name and description)
  offer_recipe?: boolean; // false leaves out "happy to send the recipe" when asking
  plan?: { serves?: string | number; dietary?: string; recipe?: string; notes?: string };
  shopping?: unknown;
  prep_ahead?: unknown; // steps before the day (defrosting, make-ahead)
  oven?: { name: string; when?: string; temp?: string; minutes?: number }; // which oven on the day, e.g. { name: Main, when: "11:20-1:00", temp: "450°F" }
  day_of?: unknown; // the day itself
};

// WhatsApp ids are digits with country code; bare 10-digit numbers are assumed US
export const phoneKey = (p: string | number) => {
  const d = String(p).replace(/\D/g, "");
  return d.length === 10 ? "1" + d : d;
};

function readYaml(path: string) {
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
  return parse(readFileSync(path, "utf8"));
}
const readText = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

export function loadConfig(
  dataDir = DATA_DIR,
  holiday = process.env.HOLIDAY ?? "thanksgiving",
  year = process.env.YEAR ?? String(new Date().getFullYear()),
) {
  const holidayDir = join(dataDir, "holidays", holiday);
  const eventDir = join(holidayDir, year);
  const family = readYaml(join(dataDir, "family.yaml"));
  const host: Person = { household: family.host.name, ...family.host, phone: phoneKey(family.host.phone) };
  const people: Person[] = (family.people ?? []).map((p: Person) => ({ household: p.name, ...p, phone: phoneKey(p.phone) }));
  const eventFile = join(eventDir, "event.yaml");
  const event = readYaml(eventFile);
  // How each dish is worded when asking for it; lives beside persona.yaml so it carries over to next year by dish name
  const requestsFile = join(holidayDir, "requests.yaml");
  const requestPrefs: Record<string, Partial<Dish>> = existsSync(requestsFile) ? (readYaml(requestsFile) ?? {}) : {};
  const prefsFor = (name: string) =>
    Object.entries(requestPrefs).find(([k]) => k.trim().toLowerCase() === name.trim().toLowerCase())?.[1] ?? {};
  return {
    dataDir,
    eventDir,
    eventFile,
    host,
    people,
    persona: readYaml(join(holidayDir, "persona.yaml")),
    event,
    // the file uses capitalized courses and statuses ("Side", "Proposed"); the code compares them lowercase
    menu: ((event.menu ?? []) as Dish[]).map((d) =>
      ({ ...prefsFor(d.dish), ...d, status: d.status?.toLowerCase(), course: d.course?.toLowerCase() }) as Dish),
    ovens: (event.day_of?.ovens ?? []) as Oven[],
    eventYaml: readText(eventFile),
    plan: readText(join(eventDir, "plan.md")),
    schedule: readText(join(eventDir, "schedule.md")),
  };
}
export type Config = ReturnType<typeof loadConfig>;
export type Oven = { name: string; gluten_free_only?: boolean };

/** "brussels sprout salad" → "Brussels Sprout Salad"; letters already capitalized (GF) are left alone. */
export const titleCase = (s: string) => s.trim().replace(/(^|[\s(\/-])(\p{Ll})/gu, (_, sep, c) => sep + c.toUpperCase());

const sameDish = (a: unknown, b: string) => String(a).trim().toLowerCase() === b.trim().toLowerCase();

/** Updates a dish in event.yaml (or appends it if new), keeping the file's comments and layout. */
export function saveDish(eventFile: string, name: string, patch: Partial<Dish>) {
  const doc = parseDocument(readFileSync(eventFile, "utf8"));
  const menu = doc.get("menu") as YAMLSeq<YAMLMap> | undefined;
  const item = menu?.items.find((d) => sameDish(d.get("dish"), name));
  for (const k of ["dish", "course", "status"] as const) if (typeof patch[k] === "string") (patch as Record<string, string>)[k] = titleCase(patch[k]);
  if (item) for (const [k, v] of Object.entries(patch)) item.set(k, v);
  else doc.addIn(["menu"], doc.createNode({ dish: titleCase(name), ...patch }));
  writeFileSync(eventFile, doc.toString({ lineWidth: 0 }));
}

export function removeDish(eventFile: string, name: string) {
  const doc = parseDocument(readFileSync(eventFile, "utf8"));
  const menu = doc.get("menu") as YAMLSeq<YAMLMap> | undefined;
  const i = menu?.items.findIndex((d) => sameDish(d.get("dish"), name)) ?? -1;
  if (i >= 0) menu!.delete(i);
  writeFileSync(eventFile, doc.toString({ lineWidth: 0 }));
}

export const findDish = (config: Config, name: string) => config.menu.find((d) => sameDish(d.dish, name));
