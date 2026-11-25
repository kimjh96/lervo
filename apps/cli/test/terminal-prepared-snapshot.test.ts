import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  readPreparedRepositorySnapshot,
  writePreparedRepositorySnapshot,
} from "../src/terminal-prepared-snapshot.js";

it("retains a newly prepared snapshot even when its random ID sorts before all older snapshots", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-prepared-retention-"));
  try {
    const initial = {
      schemaVersion: 1 as const,
      observationId: "tobs_zzzzzzzz",
      revision: `sha256:${"a".repeat(64)}`,
      files: {},
    };
    await writePreparedRepositorySnapshot(root, initial);
    const directory = resolve(root, ".lervo/state/terminal-integration/prepared-snapshots");
    await utimes(resolve(directory, `${initial.observationId}.json`), 1, 1);
    for (let index = 0; index < 63; index++) {
      const observationId = `tobs_y${String(index).padStart(7, "0")}`;
      const path = resolve(directory, `${observationId}.json`);
      await writeFile(path, JSON.stringify({ ...initial, observationId }));
      await utimes(path, index + 2, index + 2);
    }
    const latest = { ...initial, observationId: "tobs_00000000" };
    await writePreparedRepositorySnapshot(root, latest);
    expect(await readPreparedRepositorySnapshot(root, latest.observationId)).toEqual(latest);
    expect(await readPreparedRepositorySnapshot(root, initial.observationId)).toBeNull();
    expect((await readdir(directory)).filter((name) => name.startsWith("tobs_"))).toHaveLength(64);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const snapshot = (observationId: string, hash = "b") => ({
  schemaVersion: 1 as const,
  observationId,
  revision: `sha256:${"a".repeat(64)}`,
  files: { "src/index.ts": `sha256:${hash.repeat(64)}` },
  commits: { "src/index.ts": "c".repeat(40) },
});

async function withRoot(test: (root: string, directory: string) => Promise<void>) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-prepared-content-"));
  try {
    await test(root, resolve(root, ".lervo/state/terminal-integration/prepared-snapshots"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it("stores identical snapshots once and gives each observation its own pointer", async () => {
  await withRoot(async (root, directory) => {
    await writePreparedRepositorySnapshot(root, snapshot("tobs_first000"));
    await writePreparedRepositorySnapshot(root, snapshot("tobs_second00"));
    expect(await readdir(resolve(directory, "contents"))).toHaveLength(1);
    expect(await readPreparedRepositorySnapshot(root, "tobs_first000")).toEqual(
      snapshot("tobs_first000"),
    );
    expect(await readPreparedRepositorySnapshot(root, "tobs_second00")).toEqual(
      snapshot("tobs_second00"),
    );
    // A pointer holds no file hashes.
    expect(await readFile(resolve(directory, "tobs_second00.json"), "utf8")).not.toContain(
      "src/index.ts",
    );
  });
});

it("rejects stored content that no longer matches its pointer", async () => {
  await withRoot(async (root, directory) => {
    await writePreparedRepositorySnapshot(root, snapshot("tobs_first000"));
    const [name] = await readdir(resolve(directory, "contents"));
    const path = resolve(directory, "contents", name!);
    await writeFile(path, (await readFile(path, "utf8")).replace("b".repeat(64), "d".repeat(64)));
    await expect(readPreparedRepositorySnapshot(root, "tobs_first000")).rejects.toThrow(
      "does not match its pointer",
    );
  });
});

it("removes content no retained pointer names, once it is old enough", async () => {
  await withRoot(async (root, directory) => {
    await writePreparedRepositorySnapshot(root, snapshot("tobs_first000", "b"));
    await rm(resolve(directory, "tobs_first000.json"));
    const [orphan] = await readdir(resolve(directory, "contents"));
    // A young orphan may be a concurrent writer's, whose pointer is not written yet.
    await writePreparedRepositorySnapshot(root, snapshot("tobs_second00", "e"));
    expect(await readdir(resolve(directory, "contents"))).toContain(orphan);
    await utimes(resolve(directory, "contents", orphan!), 1, 1);
    await writePreparedRepositorySnapshot(root, snapshot("tobs_third000", "e"));
    expect(await readdir(resolve(directory, "contents"))).not.toContain(orphan);
    expect(await readdir(resolve(directory, "contents"))).toHaveLength(1);
  });
});

it("keeps reused content safe from another writer's retention", async () => {
  await withRoot(async (root, directory) => {
    await writePreparedRepositorySnapshot(root, snapshot("tobs_first000"));
    const [name] = await readdir(resolve(directory, "contents"));
    const path = resolve(directory, "contents", name!);
    await utimes(path, 1, 1);
    await writePreparedRepositorySnapshot(root, snapshot("tobs_second00"));
    // Reuse refreshed it, so it is young again for the next writer's retention.
    expect((await stat(path)).mtimeMs).toBeGreaterThan(Date.now() - 60_000);
  });
});

it("repairs stored content that changed on disk when the same snapshot is prepared again", async () => {
  await withRoot(async (root, directory) => {
    await writePreparedRepositorySnapshot(root, snapshot("tobs_first000"));
    const [name] = await readdir(resolve(directory, "contents"));
    const path = resolve(directory, "contents", name!);
    await writeFile(path, (await readFile(path, "utf8")).replace("b".repeat(64), "d".repeat(64)));
    await writePreparedRepositorySnapshot(root, snapshot("tobs_second00"));
    expect(await readPreparedRepositorySnapshot(root, "tobs_first000")).toEqual(
      snapshot("tobs_first000"),
    );
  });
});
