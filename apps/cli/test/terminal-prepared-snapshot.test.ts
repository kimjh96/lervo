import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
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
    expect(await readdir(directory)).toHaveLength(64);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
