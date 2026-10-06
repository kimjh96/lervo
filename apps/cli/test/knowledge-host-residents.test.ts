import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { registerRepository } from "@lervo/repository-registry";
import { afterEach, expect, it, vi } from "vitest";

import { fixture } from "../../../packages/repository-knowledge-runtime/test/fixture.js";

const ports = vi.hoisted(() => ({
  open: vi.fn(),
  start: vi.fn(() => async () => undefined),
}));
vi.mock("@lervo/project-storage", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  openProjectStorage: ports.open,
}));
vi.mock("@lervo/repository-knowledge-runtime", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  startAutonomousKnowledgeWorker: ports.start,
}));

const { startHostKnowledgeResidents } = await import("../src/knowledge-host-residents.js");

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

/** The reason the checkout's private resident heartbeat reports, or null without one. */
function healthReason(root: string): string | null {
  const path = resolve(root, ".lervo/state/knowledge/resident-health.sqlite");
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("SELECT reason FROM residents WHERE state = 'attention'").get() as
      { reason: string | null } | undefined;
    return row?.reason ?? null;
  } finally {
    db.close();
  }
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for host residents.");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
}

async function delegatedHost() {
  const delegated = await fixture(true);
  fixtures.push(delegated);
  const state = resolve(delegated.directory, "user-state");
  await mkdir(state, { recursive: true, mode: 0o700 });
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", state);
  await registerRepository({
    registryPath: resolve(state, "repositories.json"),
    repositoryRoot: delegated.root,
  });
  return { delegated, state, root: await realpath(delegated.root) };
}

async function hostStatus(state: string) {
  return JSON.parse(await readFile(resolve(state, "knowledge-host-resident.json"), "utf8")) as {
    role: string;
    launch: string;
    repositories: Array<{ repositoryRoot: string; state: string; reason: string; detail: string }>;
  };
}

it("activates an outdated local writer and then starts the resident", async () => {
  const { delegated, state, root } = await delegatedHost();
  const admitted = { ...delegated.storage, close: async () => undefined };
  ports.open
    .mockResolvedValueOnce({ ...admitted, writableEventSchemaVersion: 3 })
    .mockResolvedValue(admitted);
  const activate = vi.fn(async () => ({ status: "activated" as const, backup: {} as never }));
  const stop = startHostKnowledgeResidents({
    provider: null,
    launch: "service",
    activate,
    onFailure: () => undefined,
  });
  try {
    await until(() => ports.start.mock.calls.length >= 1);
    expect(activate).toHaveBeenCalledWith(root);
    await until(() => {
      try {
        return readFileSync(resolve(state, "knowledge-host-resident.json")).length > 0;
      } catch {
        return false;
      }
    });
    expect(await hostStatus(state)).toMatchObject({
      role: "active",
      launch: "service",
      repositories: [{ repositoryRoot: root, state: "serving" }],
    });
  } finally {
    await stop();
  }
});

it("holds a checkout whose activation is blocked, with a visible reason, instead of skipping it", async () => {
  const { delegated, state, root } = await delegatedHost();
  ports.open.mockResolvedValue({
    ...delegated.storage,
    writableEventSchemaVersion: 1,
    close: async () => undefined,
  });
  const failures: unknown[] = [];
  const stop = startHostKnowledgeResidents({
    provider: null,
    activate: async () => ({ status: "held", code: "terminal_hook_reader_stale" }),
    onFailure: (_root, error) => failures.push(error),
  });
  try {
    await until(() => {
      try {
        return readFileSync(resolve(state, "knowledge-host-resident.json")).includes("held");
      } catch {
        return false;
      }
    });
    expect(ports.start).not.toHaveBeenCalled();
    expect((await hostStatus(state)).repositories).toEqual([
      {
        repositoryRoot: root,
        state: "held",
        reason: "event_schema_outdated",
        detail: "terminal_hook_reader_stale",
      },
    ]);
    await until(() => failures.length > 0 || healthReason(delegated.root) !== null);
    expect(healthReason(delegated.root)).toBe("event_schema_outdated");
  } finally {
    await stop();
  }
});

it("stays on standby while another live host resident holds the host lock", async () => {
  const { state } = await delegatedHost();
  await writeFile(
    resolve(state, "knowledge-host-resident.lock"),
    JSON.stringify({ schemaVersion: 1, pid: process.ppid }),
  );
  const stop = startHostKnowledgeResidents({ provider: null, onFailure: () => undefined });
  try {
    await until(() => {
      try {
        return readFileSync(resolve(state, "knowledge-host-resident.json")).includes("standby");
      } catch {
        return false;
      }
    });
    expect(ports.open).not.toHaveBeenCalled();
    expect(ports.start).not.toHaveBeenCalled();
  } finally {
    await stop();
  }
});

it("starts one resident per delegated registered checkout and none for unenrolled ones", async () => {
  const delegated = await fixture(true);
  fixtures.push(delegated);
  const plain = resolve(delegated.directory, "plain");
  await mkdir(plain);
  await applyInitPlan(await createInitPlan({ root: plain, projectId: "prj_host_resident_plain" }));
  const state = resolve(delegated.directory, "user-state");
  await mkdir(state, { recursive: true, mode: 0o700 });
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", state);
  for (const root of [delegated.root, plain])
    await registerRepository({
      registryPath: resolve(state, "repositories.json"),
      repositoryRoot: root,
    });
  ports.open.mockResolvedValue({ ...delegated.storage, close: async () => undefined });
  const failures: unknown[] = [];
  const stop = startHostKnowledgeResidents({
    provider: null,
    onFailure: (_root, error) => failures.push(error),
  });
  try {
    await until(() => ports.start.mock.calls.length >= 1);
    // One scan is complete once the delegated resident starts; the undelegated one is skipped.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    expect(ports.start).toHaveBeenCalledTimes(1);
    expect(ports.start).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude", continuity: expect.anything() }),
    );
    expect(failures).toEqual([]);
  } finally {
    await stop();
  }
});
