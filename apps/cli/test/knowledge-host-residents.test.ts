import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

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

async function until(condition: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for host residents.");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
}

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
