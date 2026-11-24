import type { Db } from "./db.ts";
import type { Dish, loadConfig } from "./config.ts";

const owners = (d: Dish) => [d.owner ?? []].flat().map(String).filter(Boolean);
const text = (v: unknown) => (Array.isArray(v) ? v.join("; ") : v ? String(v) : "");
const day = (ts: unknown) => new Date(Number(ts)).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Notes for next year's plan, from this year's event.yaml and the bot's records: tasks, supplies, shopping, who was asked, and every change guests made by text. */
export function notesText(config: ReturnType<typeof loadConfig>, db: Db) {
  const menu = config.menu as Dish[];
  const line = (d: Dish) => `- ${d.dish}${d.description ? ` (${d.description})` : ""}: ${owners(d).join(", ") || "no owner"}${d.done_by ? `, by ${d.done_by}` : ""} [${d.status ?? "proposed"}]`;
  const kind = (d: Dish) => String(d.course ?? "").toLowerCase();
  const out = [`# ${config.event.title}: notes for next year`, "", "_Rewritten every few minutes while the bot runs._", ""];

  out.push("## Tasks and errands", ...menu.filter((d) => kind(d) === "task" || d.done_by).map(line), "");
  out.push("## Supplies people were asked to bring", ...menu.filter((d) => kind(d) === "supplies").map(line), "");

  const shop = (config.event.shopping ?? {}) as Record<string, unknown>;
  out.push("## Shopping", `- Order: ${text(shop.order)}`, ...[shop.items ?? []].flat().map((i) => `- Extra: ${i}`));
  for (const d of menu) if (text(d.shopping)) out.push(`- ${d.dish} (${owners(d).join(", ") || "no owner"}): ${text(d.shopping)}`);
  out.push("");

  out.push("## Who was asked to bring or do what");
  const byPerson = new Map<string, string[]>();
  for (const d of menu) for (const o of owners(d)) byPerson.set(o, [...(byPerson.get(o) ?? []), `${d.dish}${d.done_by ? ` (by ${d.done_by})` : ""}${d.status === "confirmed" ? "" : ` [${d.status ?? "proposed"}]`}`]);
  for (const [who, items] of [...byPerson].sort()) out.push(`- ${who}: ${items.join("; ")}`);
  out.push("");

  const who = (ph: unknown) => config.people.find((p) => p.phone === ph)?.name ?? (ph === config.host.phone ? config.host.name : String(ph));
  const changes = db.prepare("SELECT ts, phone, action, detail FROM changes WHERE action NOT IN ('held_message') ORDER BY id").all();
  out.push("## Changes made by text", ...changes.map((c) => `- ${day(c.ts)}, ${who(c.phone)}: ${c.action} ${c.detail}`), "");
  return out.join("\n");
}
