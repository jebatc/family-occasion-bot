import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, logChange } from "../src/db.ts";
import { notesText } from "../src/notes.ts";

test("notes list tasks, supplies, shopping, who was asked, and changes by text", () => {
  const db = openDb(":memory:");
  logChange(db, "1555", "record_contribution", '{"dish":"Dish Gloves"}');
  const config: any = {
    event: { title: "Thanksgiving 2099", shopping: { order: "Instacart Monday", items: ["Candles"] } },
    people: [{ name: "Lily", phone: "1555" }],
    host: { name: "Jenn", phone: "1999" },
    menu: [
      { dish: "Pick up the wine", course: "Task", owner: "Clark", status: "confirmed", done_by: "Wednesday" },
      { dish: "Dish Gloves", course: "Supplies", owner: "Lily", status: "confirmed" },
      { dish: "Roast Turkey", course: "main", owner: "Jenn", shopping: "16 lb turkey" },
    ],
  };
  const t = notesText(config, db);
  assert.match(t, /Pick up the wine.*Clark, by Wednesday/);
  assert.match(t, /Supplies[\s\S]*Dish Gloves: Lily/);
  assert.match(t, /Extra: Candles/);
  assert.match(t, /Roast Turkey \(Jenn\): 16 lb turkey/);
  assert.match(t, /Lily: Dish Gloves/);
  assert.match(t, /Lily: record_contribution/);
});
