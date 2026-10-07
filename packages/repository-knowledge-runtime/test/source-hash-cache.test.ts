import { mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";

import { captureConvergenceSources } from "../src/source-capture.js";
import { SOURCE_HASH_CACHE_PATH } from "../src/source-hash-cache.js";
import { fixture } from "./fixture.js";
import { sqliteRows } from "../src/sqlite-row.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function cache(root: string) {
  return new DatabaseSync(resolve(root, SOURCE_HASH_CACHE_PATH));
}

/** Ages every entry beyond the racy window, as a later resident cycle would observe it. */
function age(root: string) {
  const db = cache(root);
  try {
    db.prepare("UPDATE sources SET hashed_at_ns=?").run(
      ((BigInt(Date.now()) + 60_000n) * 1_000_000n).toString(),
    );
  } finally {
    db.close();
  }
}

it("returns byte-identical captures from hits and misses and invalidates on content change", async () => {
  const f = await fixture();
  fixtures.push(f);
  await mkdir(resolve(f.root, ".lervo/state/knowledge"), { recursive: true });
  await rm(resolve(f.root, SOURCE_HASH_CACHE_PATH), { force: true });
  const uncached = captureConvergenceSources(f.root, "policy");
  expect((await stat(resolve(f.root, SOURCE_HASH_CACHE_PATH))).mode & 0o777).toBe(0o600);
  age(f.root);
  expect(captureConvergenceSources(f.root, "policy")).toEqual(uncached);

  // A trusted hit is really served from the cache.
  const db = cache(f.root);
  db.prepare("UPDATE sources SET sha256=? WHERE path='README.md'").run(sha256("cached"));
  db.close();
  expect(
    captureConvergenceSources(f.root, "policy").sources.find((item) => item.path === "README.md")
      ?.contentHash,
  ).toBe(sha256("cached"));

  // Same size and restored mtime still change ctime, so the exact bytes are read again.
  const readme = resolve(f.root, "README.md");
  const before = await stat(readme);
  const replacement = "# Repositorx\n\nSee [runtime](docs/specs/runtime.md).\n";
  expect(Buffer.byteLength(replacement)).toBe(before.size);
  await writeFile(readme, replacement);
  await utimes(readme, before.atime, before.mtime);
  const changed = captureConvergenceSources(f.root, "policy");
  expect(changed.sources.find((item) => item.path === "README.md")?.contentHash).toBe(
    sha256(replacement),
  );
  expect(changed.snapshotHash).not.toBe(uncached.snapshotHash);

  // Racy entries are never trusted: a fresh entry is re-read even with matching metadata.
  const racy = cache(f.root);
  racy
    .prepare("UPDATE sources SET sha256=?, hashed_at_ns=? WHERE path='README.md'")
    .run(sha256("racy"), (BigInt(Date.now()) * 1_000_000n).toString());
  racy.close();
  expect(
    captureConvergenceSources(f.root, "policy").sources.find((item) => item.path === "README.md")
      ?.contentHash,
  ).toBe(sha256(replacement));
});

it("prunes absent paths and rebuilds a corrupt cache", async () => {
  const f = await fixture();
  fixtures.push(f);
  await mkdir(resolve(f.root, ".lervo/state/knowledge"), { recursive: true });
  await writeFile(resolve(f.root, "docs/specs/extra.md"), "# Extra\n");
  captureConvergenceSources(f.root, "policy");
  const paths = () => {
    const db = cache(f.root);
    try {
      return sqliteRows(db.prepare("SELECT path FROM sources ORDER BY path").all()).map(
        (row) => row.path,
      );
    } finally {
      db.close();
    }
  };
  expect(paths()).toContain("docs/specs/extra.md");
  await rm(resolve(f.root, "docs/specs/extra.md"));
  captureConvergenceSources(f.root, "policy");
  expect(paths()).not.toContain("docs/specs/extra.md");
  await writeFile(resolve(f.root, SOURCE_HASH_CACHE_PATH), "not a database".repeat(100));
  const rebuilt = captureConvergenceSources(f.root, "policy");
  expect(paths()).toEqual(rebuilt.sources.map((source) => source.path).sort());
});
