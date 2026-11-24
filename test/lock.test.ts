import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock } from "../src/lock.ts";

const lock = () => join(mkdtempSync(join(tmpdir(), "hc-lock-")), "bot.pid");

test("a second copy is refused while the first is alive", () => {
  const p = lock();
  assert.equal(acquireLock(p, 999_999_001), true);
  writeFileSync(p, String(process.ppid)); // a live process other than us
  assert.equal(acquireLock(p), false);
});

test("a lock left by a dead process is taken over", () => {
  const p = lock();
  writeFileSync(p, "999999999");
  assert.equal(acquireLock(p), true);
});
