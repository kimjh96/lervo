import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import * as sqlite from "@lervo/sqlite-connection";
import { afterEach, expect, it, vi } from "vitest";
import { readKnowledgeProviderPauseStates } from "../src/provider-admission-inspection.js";
import { pauseKnowledgeProvider } from "../src/provider-admission.js";
import { inspectConvergenceContinuity } from "../src/continuity-inspection.js";
import { PROVIDER_CLI_STATE_PATH } from "../src/provider-cli-projection.js";
import { writePrivateJsonFile } from "../src/private-state-file.js";

vi.mock("node:os", async (original) => {
  const os = await original<typeof import("node:os")>();
  return { ...os, homedir: vi.fn(os.homedir) };
});
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    await chmod(resolve(root, ".lervo/state/knowledge-provider-admission"), 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-admission-inspection-"));
  roots.push(root);
  vi.mocked(homedir).mockReturnValue(root);
  return { root, directory: resolve(root, ".lervo/state/knowledge-provider-admission") };
}
async function snapshot(directory: string) {
  const path = resolve(directory, "admission.sqlite");
  const [file, parent] = await Promise.all([lstat(path), lstat(directory)]);
  return {
    bytes: await readFile(path),
    entries: await readdir(directory),
    file: { mode: file.mode, mtimeMs: file.mtimeMs, size: file.size },
    parent: { mode: parent.mode, mtimeMs: parent.mtimeMs },
  };
}

it("treats an absent admission store as no data without creating its directory", async () => {
  const f = await fixture();
  expect(await readKnowledgeProviderPauseStates()).toEqual([]);
  await expect(lstat(f.directory)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["old", "current", "invalid"])(
  "inspects a %s store without changing bytes, permissions, schema or sidecar files",
  async (schema) => {
    const f = await fixture();
    const now = new Date("2026-10-31T00:00:00Z");
    await mkdir(f.directory, { recursive: true, mode: 0o700 });
    if (schema === "current")
      await pauseKnowledgeProvider({
        provider: "claude",
        reason: "quota",
        resetAt: null,
        observationHash: `sha256:${"a".repeat(64)}`,
        directory: f.directory,
        now,
      });
    else if (schema === "old") {
      const db = sqlite.openSqliteDatabase(resolve(f.directory, "admission.sqlite"), {
        busyTimeoutMs: 0,
      });
      db.exec(
        "CREATE TABLE provider_pauses(provider TEXT, reason TEXT, observation_hash TEXT, observed_at INTEGER, reset_at INTEGER)",
      );
      db.close();
    } else await writeFile(resolve(f.directory, "admission.sqlite"), "invalid database");
    await chmod(resolve(f.directory, "admission.sqlite"), 0o400);
    await chmod(f.directory, 0o500);
    const before = await snapshot(f.directory);
    const open = vi.spyOn(sqlite, "openSqliteDatabase");
    const states = await readKnowledgeProviderPauseStates({ now });
    if (schema === "current")
      expect(states).toContainEqual(
        expect.objectContaining({
          provider: "claude",
          paused: true,
          reason: "quota",
          observedAt: now.toISOString(),
          nextReprobeAt: "2026-10-31T01:00:00.000Z",
        }),
      );
    else expect(states).toEqual([]);
    expect(open).toHaveBeenCalledWith(resolve(f.directory, "admission.sqlite"), {
      readOnly: true,
      busyTimeoutMs: 0,
    });
    expect(await snapshot(f.directory)).toEqual(before);
  },
);

it("preserves provider rejection and unrelated continuity findings when admission reads fail", async () => {
  const f = await fixture();
  await pauseKnowledgeProvider({
    provider: "claude",
    reason: "quota",
    resetAt: null,
    observationHash: `sha256:${"a".repeat(64)}`,
    directory: f.directory,
  });
  await writePrivateJsonFile(resolve(f.root, PROVIDER_CLI_STATE_PATH), {
    observedAt: new Date().toISOString(),
    selected: null,
    waiting: true,
    detectionFailure: null,
    providers: [
      {
        provider: "codex",
        version: "0.166.0",
        executableHash: `sha256:${"b".repeat(64)}`,
        admitted: false,
        reason: "capabilities_exposed",
        exposedTools: ["exec"],
      },
    ],
  });
  vi.spyOn(sqlite, "openSqliteDatabase").mockImplementation(() => {
    throw Object.assign(new Error("read unavailable"), { code: "EACCES" });
  });
  const inspection = await inspectConvergenceContinuity({
    repositoryRoot: f.root,
    policyPath: null,
    residentHost: null,
    hookRuntime: "stale",
    replicaDiverged: true,
  });
  expect(inspection.findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining([
      "provider_cli_rejected",
      "provider_not_admitted",
      "hook_runtime_stale",
      "replica_diverged",
    ]),
  );
});
