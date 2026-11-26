import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { capturePersistentRepositorySnapshot, captureRepositorySnapshot } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("reuses persisted stat-identity hashes without changing snapshot semantics", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-cache-"));
  roots.push(root);
  await writeFile(resolve(root, "a.txt"), "alpha\n");
  await writeFile(resolve(root, "b.txt"), "beta\n");
  const cache = resolve(root, ".lervo/state/cache/snapshot.json");
  const first = await capturePersistentRepositorySnapshot(root, cache);
  expect(first).toEqual(await captureRepositorySnapshot(root));
  expect(JSON.parse(await readFile(cache, "utf8"))).toMatchObject({ schemaVersion: 1 });

  await writeFile(resolve(root, "b.txt"), "beta changed\n");
  const second = await capturePersistentRepositorySnapshot(root, cache);
  expect(second).toEqual(await captureRepositorySnapshot(root));
  expect(second.revision).not.toBe(first.revision);

  // A corrupt cache falls back to an ordinary full capture.
  await writeFile(cache, "{not json");
  expect(await capturePersistentRepositorySnapshot(root, cache)).toEqual(second);
});

it("reads the cache again once another writer replaced the one this process wrote", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-cache-writer-"));
  roots.push(root);
  await writeFile(resolve(root, "a.txt"), "alpha\n");
  const cache = resolve(root, ".lervo/state/cache/snapshot.json");
  const first = await capturePersistentRepositorySnapshot(root, cache);
  // Another process writes a cache whose entry trusts a wrong hash for the same stat identity.
  // Reading it shows in the result, which is how a trusted cache behaves; keeping the remembered
  // one would hide that the file changed.
  const written = JSON.parse(await readFile(cache, "utf8")) as {
    entries: [string, { hash: string }][];
  };
  const forged = `sha256:${"f".repeat(64)}`;
  written.entries[0]![1].hash = forged;
  await writeFile(`${cache}.other`, JSON.stringify(written));
  await rename(`${cache}.other`, cache);
  const second = await capturePersistentRepositorySnapshot(root, cache);
  expect(second.files["a.txt"]).toBe(forged);
  expect(first.files["a.txt"]).not.toBe(forged);
});
