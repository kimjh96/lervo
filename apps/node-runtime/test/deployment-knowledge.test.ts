import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { sealConvergenceContinuityPolicy } from "@lervo/repository-knowledge-runtime";
import { afterEach, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({ start: vi.fn(() => async () => undefined) }));
vi.mock("../src/repository-knowledge-loop.js", () => ({
  startRepositoryKnowledgeLoop: ports.start,
}));

const { startDeploymentKnowledgeLoop } = await import("../src/deployment-knowledge.js");

const DAY = 24 * 60 * 60_000;
const hub = {
  baseUrl: "https://hub.example/",
  bearerTokenFile: "/owner-only/hub-token",
  destinationId: "hub:primary",
  hubIdentityHash: `sha256:${"a".repeat(64)}`,
};
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  ports.start.mockClear();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function repository(): Promise<ProjectStorage> {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-deployment-knowledge-"));
  directories.push(directory);
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", resolve(directory, "state"));
  return {
    paths: { repositoryRoot: resolve(directory, "repository") },
    writableEventSchemaVersion: 4,
  } as unknown as ProjectStorage;
}

async function installPolicy(storage: ProjectStorage) {
  const state = resolve(storage.paths.repositoryRoot, "../state");
  await mkdir(state, { recursive: true });
  const ceilings = {
    maximumStages: 8,
    maximumDocuments: 8,
    maximumSourceBytes: 1_048_576,
    maximumProviderCalls: 8,
  };
  await writeFile(
    resolve(state, "knowledge-continuity-policy.json"),
    JSON.stringify(
      sealConvergenceContinuityPolicy({
        schemaVersion: 1,
        state: "active",
        authority: { kind: "owner_instruction", reference: "ADR-0469" },
        issuedAt: new Date(Date.now() - DAY).toISOString(),
        horizonAt: new Date(Date.now() + 300 * DAY).toISOString(),
        renewal: { termDays: 30, windowHours: 48, attentionLeadHours: 72 },
        seeding: { fromPeer: true, fromTemplate: true },
        limits: { providers: ["codex"], resourceCeilings: ceilings },
        template: {
          parentRoleId: "developer",
          roleIds: {
            generator: "developer",
            reviewer: "developer",
            writer: "developer",
            integrator: "developer",
          },
          canonicalRoots: ["docs"],
          normalizationRoots: ["docs"],
          providers: ["codex"],
          integrationRef: "refs/heads/lervo/knowledge-integration",
          resourceCeilings: ceilings,
          verificationSuite: "repository_default",
        },
      }),
    ),
    { mode: 0o600 },
  );
}

it("starts no resident for an undelegated repository on a host without a continuity policy", async () => {
  const storage = await repository();
  await startDeploymentKnowledgeLoop({
    storage,
    store: {} as never,
    signal: new AbortController().signal,
    hub,
  });
  expect(ports.start).not.toHaveBeenCalled();
});

it("starts a resident with the policy's provider and the Node's Hub coordinates", async () => {
  const storage = await repository();
  await installPolicy(storage);
  await startDeploymentKnowledgeLoop({
    storage,
    store: {} as never,
    signal: new AbortController().signal,
    hub,
  });
  expect(ports.start).toHaveBeenCalledWith(expect.objectContaining({ provider: "codex", hub }));
});

it("starts the resident child for an outdated writer so it holds and resumes after activation", async () => {
  const storage = await repository();
  await installPolicy(storage);
  await startDeploymentKnowledgeLoop({
    storage: { ...storage, writableEventSchemaVersion: 3 } as ProjectStorage,
    store: {} as never,
    signal: new AbortController().signal,
    workerEntry: "/runtime/node-runtime.js",
  });
  expect(ports.start).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "codex", awaitAdmission: true }),
  );
});

it("keeps an in-process hold beside the supervision loop when the writer is outdated", async () => {
  const storage = await repository();
  await installPolicy(storage);
  await mkdir(storage.paths.repositoryRoot, { recursive: true });
  const stop = await startDeploymentKnowledgeLoop({
    storage: { ...storage, writableEventSchemaVersion: 1 } as ProjectStorage,
    store: {} as never,
    signal: new AbortController().signal,
    supervision: { ownerReasoning: { provider: "claude" } } as never,
  });
  try {
    expect(ports.start).toHaveBeenCalledTimes(1);
    expect(ports.start).toHaveBeenCalledWith(expect.objectContaining({ provider: "claude" }));
    expect(ports.start).not.toHaveBeenCalledWith(expect.objectContaining({ awaitAdmission: true }));
  } finally {
    await stop();
  }
});
