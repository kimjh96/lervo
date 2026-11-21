import { rm } from "node:fs/promises";

import {
  appendRepositoryChange,
  planRepositoryChange,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
} from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import {
  readRepositoryKnowledgeJobAdmission,
  writeConvergenceOwnerFence,
} from "../src/convergence-owner-fence.js";
import type { ConvergenceOwnerVerdict } from "../src/convergence-owner-verdict.js";
import { runNonOwnerCycle } from "../src/non-owner-cycle.js";
import { fixture } from "./fixture.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const hash = (fill: string) => `sha256:${fill.repeat(64)}`;

async function heldJobs(count: number) {
  const f = await fixture(true);
  cleanups.push(async () => {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  for (let index = 0; index < count; index++) {
    const planned = planRepositoryChange({
      sourceKind: "terminal_turn",
      sourceEventId: `evt_${String(index).repeat(32)}`,
      before: { revision: hash("b"), files: { "docs/a.md": hash("1") } },
      after: { revision: hash("c"), files: { "docs/a.md": hash(String(index + 2)) } },
      occurredAt: "2026-10-17T17:22:00.000Z",
    })!;
    f.storage.events.transact((transaction) =>
      appendRepositoryChange(
        transaction,
        {
          eventId: `evt_${"e".repeat(31)}${index}`,
          projectId: f.storage.manifest.projectId,
          runId: `run_${"0".repeat(32)}`,
          sessionId: `ses_${"0".repeat(32)}`,
          occurredAt: "2026-10-17T17:22:00.000Z",
          actor: { kind: "system" },
          policyVersion: hash("a"),
        },
        planned,
        { admitted: true },
      ),
    );
  }
  return f;
}

const verdict = (role: ConvergenceOwnerVerdict["role"]) =>
  ({
    role,
    reason:
      role === "waiting_owner" ? "convergence_owner_elsewhere" : "convergence_owner_unverifiable",
    mode: "hub",
    hostHash: `sha256:${"1".repeat(64)}`,
    hostLabel: "mac",
    holder: null,
    validUntil: null,
    wakeAt: null,
    grantedAt: null,
    yieldUntil: null,
    observedAt: new Date().toISOString(),
  }) as ConvergenceOwnerVerdict;

const run = (f: Awaited<ReturnType<typeof heldJobs>>, role: ConvergenceOwnerVerdict["role"]) =>
  runNonOwnerCycle({
    storage: f.storage,
    owner: verdict(role),
    captureOwnerTurns: async () => ({ instructionCapture: { status: "idle" } }) as never,
    observePractice: async () => undefined,
    upgradeWaiting: async () => false,
  });

it(
  "settles the jobs a host holds once another host owns its convergence (ADR-0605)",
  { timeout: 60_000 },
  async () => {
    // The axli shape: jobs a non-owner held since before it lost ownership, never claimed.
    const f = await heldJobs(12);
    expect(f.storage.events.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(12);
    await expect(run(f, "waiting_owner")).resolves.toMatchObject({ status: "waiting_owner" });
    expect(f.storage.events.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(0);
    const resolved = f.storage.events
      .list({ limit: 1_000 })
      .filter((event) => event.type === "repository.knowledge.resolved");
    expect(resolved).toHaveLength(12);
    expect(
      resolved.every(
        (event) =>
          event.payload.terminalState === "stale" &&
          event.payload.failureCode === "convergence_owner_elsewhere",
      ),
    ).toBe(true);
  },
);

it(
  "settles held jobs on a host that may not own convergence at all",
  { timeout: 60_000 },
  async () => {
    // Hub mode without a delegation: ineligible, so it never runs a job either.
    const f = await heldJobs(2);
    await run(f, "ineligible");
    expect(f.storage.events.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(0);
  },
);

it("keeps its jobs while its own ownership is only unverifiable", { timeout: 60_000 }, async () => {
  const f = await heldJobs(3);
  await run(f, "unverifiable");
  expect(f.storage.events.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(3);
});

it("admits jobs unless the recorded verdict says another host holds convergence", async () => {
  const f = await heldJobs(0);
  const root = f.storage.paths.repositoryRoot;
  // Never configured, no fence: the single-host behavior keeps its jobs.
  await expect(readRepositoryKnowledgeJobAdmission(root)).resolves.toEqual({ admitted: true });
  // Every role: only a host that runs jobs, or may again in a moment, holds them.
  for (const [role, reason] of [
    ["owner", null],
    ["unverifiable", null],
    ["yielding", null],
    ["contended", null],
    ["waiting_owner", "convergence_owner_elsewhere"],
    ["ineligible", "convergence_owner_ineligible"],
  ] as const) {
    await writeConvergenceOwnerFence(root, {
      schemaVersion: 1,
      recordedHolderKey: null,
      verdict: verdict(role),
    });
    await expect(readRepositoryKnowledgeJobAdmission(root)).resolves.toEqual(
      reason === null ? { admitted: true } : { admitted: false, reason },
    );
  }
});
