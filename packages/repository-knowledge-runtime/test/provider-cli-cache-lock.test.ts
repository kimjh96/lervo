import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { openSqliteDatabase } from "@lervo/sqlite-connection";
import { withProviderCliCacheLock } from "../src/provider-cli-cache-lock.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it("honors another holder's durable lease instead of overwriting its cache result", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-cli-cache-lock-"));
  roots.push(directory);
  await mkdir(directory, { recursive: true });
  const db = openSqliteDatabase(resolve(directory, "cache-lock.sqlite"), { busyTimeoutMs: 1000 });
  db.exec(
    "CREATE TABLE holder (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, nonce TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO holder VALUES(1,?,?)").run(process.pid, "other-holder");
  const run = vi.fn(async () => {});
  try {
    await expect(withProviderCliCacheLock(directory, run)).rejects.toMatchObject({
      code: "knowledge_capacity_unavailable",
    });
    expect(run).not.toHaveBeenCalled();
    expect(db.prepare("SELECT nonce FROM holder WHERE id=1").get()).toMatchObject({
      nonce: "other-holder",
    });
    db.exec("DELETE FROM holder");
    await withProviderCliCacheLock(directory, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT nonce FROM holder WHERE id=1").get()).toBeUndefined();
  } finally {
    db.close();
  }
});
