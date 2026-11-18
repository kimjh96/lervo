import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { resolveProjectPaths } from "@lervo/project";
import { afterEach, expect, it } from "vitest";

import { effectBackupKeptUntil, sealEffectBackup, takeEffectBackup } from "../src/effect-backup.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function backupIds(root: string): Promise<string[]> {
  return (await readdir(resolve(resolveProjectPaths(root).data, "backups"))).filter((name) =>
    name.startsWith("lbk_"),
  );
}

it("keeps every announced backup for its retention window, then prunes beyond the bound", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-effect-backup-retention-"));
  roots.push(root);
  const file = resolve(root, "settings.json");
  await writeFile(file, "{}\n");
  const taken = new Date("2026-11-01T00:00:00Z");
  for (let index = 0; index < 17; index += 1) {
    const backup = await takeEffectBackup({
      repositoryRoot: root,
      effect: "terminal_integration",
      reason: `fixture ${index}`,
      files: [file],
      now: new Date(taken.getTime() + index * 1_000),
    });
    await sealEffectBackup(root, backup);
  }
  // ADR-0561: an announced undo outlives the count bound until its notice's date.
  expect(await backupIds(root)).toHaveLength(17);
  expect(effectBackupKeptUntil(taken)).toBe("2026-12-01");
  await takeEffectBackup({
    repositoryRoot: root,
    effect: "terminal_integration",
    reason: "after the window",
    files: [file],
    now: new Date("2026-12-15T00:00:00Z"),
  });
  expect(await backupIds(root)).toHaveLength(16);
});
