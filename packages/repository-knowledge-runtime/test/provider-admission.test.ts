import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  acquireKnowledgeProviderAdmission,
  pauseKnowledgeProvider,
  knowledgeProviderAdmissionState,
} from "../src/provider-admission.js";
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function host() {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-admission-"));
  directories.push(directory);
  return { directory, provider: "claude" as const, liveWorkPending: async () => false };
}
it("shares two host slots across providers, one per repository, and preserves waiter order", async () => {
  const input = await host();
  const first = await acquireKnowledgeProviderAdmission({ ...input, repositoryRoot: "/repo/a" });
  const second = await acquireKnowledgeProviderAdmission({
    ...input,
    provider: "codex",
    repositoryRoot: "/repo/b",
  });
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(
    await acquireKnowledgeProviderAdmission({ ...input, repositoryRoot: "/repo/a" }),
  ).toBeNull();
  expect(
    await acquireKnowledgeProviderAdmission({ ...input, repositoryRoot: "/repo/c" }),
  ).toBeNull();
  expect(
    await acquireKnowledgeProviderAdmission({ ...input, repositoryRoot: "/repo/d" }),
  ).toBeNull();
  await first!.release();
  expect(
    await acquireKnowledgeProviderAdmission({ ...input, repositoryRoot: "/repo/d" }),
  ).toBeNull();
  const third = await acquireKnowledgeProviderAdmission({ ...input, repositoryRoot: "/repo/c" });
  expect(third).not.toBeNull();
  await second!.release();
  await third!.release();
  await first!.release();
});
it("yields to live work and never guesses an unknown provider reset", async () => {
  const input = await host();
  expect(
    await acquireKnowledgeProviderAdmission({
      ...input,
      repositoryRoot: "/repo/a",
      liveWorkPending: async () => true,
    }),
  ).toBeNull();
  await pauseKnowledgeProvider({
    ...input,
    reason: "quota",
    observationHash: `sha256:${"a".repeat(64)}`,
    resetAt: null,
  });
  expect(
    await knowledgeProviderAdmissionState({ ...input, now: new Date("2099-01-01") }),
  ).toMatchObject({ paused: true, resetAt: null, activeCalls: 0 });
  await expect(
    acquireKnowledgeProviderAdmission({ ...input, repositoryRoot: "/repo/a" }),
  ).rejects.toMatchObject({ code: "knowledge_provider_paused" });
  const other = await acquireKnowledgeProviderAdmission({
    ...input,
    provider: "codex",
    repositoryRoot: "/repo/b",
  });
  expect(other).not.toBeNull();
  await other!.release();
});
it("resumes only after the exact observed reset time", async () => {
  const input = await host();
  const reset = new Date("2030-01-01T00:00:00Z");
  await pauseKnowledgeProvider({
    ...input,
    reason: "quota",
    observationHash: `sha256:${"b".repeat(64)}`,
    resetAt: reset.toISOString(),
    now: new Date(reset.getTime() - 1_000),
  });
  await expect(
    acquireKnowledgeProviderAdmission({
      ...input,
      repositoryRoot: "/repo/a",
      now: () => new Date(reset.getTime() - 1),
    }),
  ).rejects.toMatchObject({ code: "knowledge_provider_paused" });
  const admitted = await acquireKnowledgeProviderAdmission({
    ...input,
    repositoryRoot: "/repo/a",
    now: () => reset,
  });
  expect(admitted).not.toBeNull();
  await admitted!.release();
});

it("does not let a paused provider's older waiter block another provider", async () => {
  const input = await host();
  const first = await acquireKnowledgeProviderAdmission({ ...input, repositoryRoot: "/repo/a" });
  const second = await acquireKnowledgeProviderAdmission({ ...input, repositoryRoot: "/repo/b" });
  expect(
    await acquireKnowledgeProviderAdmission({ ...input, repositoryRoot: "/repo/c" }),
  ).toBeNull();
  await pauseKnowledgeProvider({
    ...input,
    reason: "authentication",
    observationHash: `sha256:${"c".repeat(64)}`,
    resetAt: null,
  });
  await first!.release();
  const other = await acquireKnowledgeProviderAdmission({
    ...input,
    provider: "codex",
    repositoryRoot: "/repo/d",
  });
  expect(other).not.toBeNull();
  await second!.release();
  await other!.release();
});
