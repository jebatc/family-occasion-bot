import { readFileSync, rmSync, writeFileSync } from "node:fs";

const alive = (pid: number) => {
  try { return process.kill(pid, 0), true; } catch (err) { return (err as NodeJS.ErrnoException).code === "EPERM"; }
};

/** Claims the one-bot-at-a-time lock file. False when another live process holds it (two copies would answer every text twice). */
export function acquireLock(path: string, pid = process.pid): boolean {
  try {
    writeFileSync(path, String(pid), { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const holder = Number(readFileSync(path, "utf8"));
    if (holder && holder !== pid && alive(holder)) return false;
    writeFileSync(path, String(pid)); // stale: its owner is gone
  }
  process.once("exit", () => { try { if (Number(readFileSync(path, "utf8")) === pid) rmSync(path); } catch {} });
  return true;
}
