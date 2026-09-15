import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { runCli } from "../../cli/src/main.js";
import { readProvenAbandonedTurnFailure } from "../src/supervision-abandoned-turn-failure-source.js";
import { recoverAbandonedTurn } from "../src/supervision-abandoned-turn-recovery.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";
import { recordPreparedWorkspaceFixture } from "./supervision-prepared-workspace.fixture.js";
import { recordAbandonedManagedRun } from "./supervision-abandoned-run.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const UNIT = "lervo-node-fixture.service";
const STARTED = Date.parse("2026-09-15T04:12:00.000Z");

async function cancelCurrentGoal(root: string): Promise<void> {
  const state = (await readCurrentWorkstreamState(root))!;
  const draft = JSON.stringify({
    ...state.snapshot,
    revision: state.snapshot.revision + 1,
    status: "cancelled",
    nextActions: [],
    blockers: [],
    pendingDecisions: [],
    pendingApprovals: [],
    updatedAt: new Date().toISOString(),
  });
  const errors: string[] = [];
  const output: string[] = [];
  const io = {
    cwd: root,
    stdout: (text: string) => output.push(text),
    stderr: (text: string) => errors.push(text),
    stdin: async () => draft,
  };
  if ((await runCli(["workstream", "update", "--stdin", "--actor", "user", "--json"], io)) !== 0)
    throw new Error(errors.join(""));
  const plan = JSON.parse(output.join("")) as { planId: string };
  output.length = 0;
  if (
    (await runCli(
      ["workstream", "update", "--stdin", "--actor", "user", "--apply", plan.planId, "--json"],
      io,
    )) !== 0
  )
    throw new Error(errors.join(""));
}

it.each([false, true])(
  "settles an abandoned managed turn under an owner fence (goal cancelled: %s)",
  async (cancelled) => {
    const f = await dispatchFixture(roots, true, undefined, "developer", [
      "dispatch",
      "execute_as_owner",
    ]);
    await recordPreparedWorkspaceFixture(f);
    const storage = await openProjectStorage(f.root);
    try {
      const run = await recordAbandonedManagedRun({ fixture: f, storage, startedAt: STARTED });
      // A stranded run must stay repairable after its goal ends, which is when it is found.
      if (cancelled) await cancelCurrentGoal(f.root);
      const observedAt = new Date(STARTED + 600_000).toISOString();
      const witness = {
        schemaVersion: 1 as const,
        kind: "host.unit_invocation_witness" as const,
        unit: UNIT,
        incidentAt: run.lastEventAt,
        incidentInvocationId: "a".repeat(32),
        incidentInvocationFirstAt: new Date(STARTED - 1000).toISOString(),
        incidentInvocationLastAt: new Date(STARTED + 120_000).toISOString(),
        successorInvocationId: "b".repeat(32),
        successorInvocationFirstAt: new Date(STARTED + 120_000).toISOString(),
        currentInvocationId: "c".repeat(32),
        inventorySha256: `sha256:${"e".repeat(64)}`,
        observedAt,
      };
      const result = await recoverAbandonedTurn({
        repositoryRoot: f.root,
        binding: f.binding,
        runId: run.identity.runId,
        unit: UNIT,
        now: () => observedAt,
        observeWitness: () => witness,
        currentInvocation: () => witness.currentInvocationId,
      });
      const events = collectRunEventsBounded({
        events: storage.events,
        runId: run.identity.runId,
        maximumEvents: 512,
      });
      const terminal = events.find((event) => event.type === "run.failed");
      expect(terminal?.eventId).toBe(result.eventId);
      expect(terminal?.payload).toEqual({
        failureCode: "interrupted_after_turn_start",
        retryable: false,
        diagnosticDigest: result.diagnosticDigest,
      });
      expect(await readProvenAbandonedTurnFailure(events, storage.artifacts)).toBe(true);
      // Nothing is fabricated to make the run settle.
      expect(events.filter((event) => event.type === "adapter.stopped")).toHaveLength(0);
      expect(events.filter((event) => event.type === "resource.usage.recorded")).toHaveLength(0);
      // A second attempt writes nothing, so a run cannot be settled twice.
      await expect(
        recoverAbandonedTurn({
          repositoryRoot: f.root,
          binding: f.binding,
          runId: run.identity.runId,
          unit: UNIT,
          now: () => observedAt,
          observeWitness: () => witness,
          currentInvocation: () => witness.currentInvocationId,
        }),
      ).rejects.toThrow();
      expect(
        collectRunEventsBounded({
          events: storage.events,
          runId: run.identity.runId,
          maximumEvents: 512,
        }).filter((event) => event.type === "run.failed"),
      ).toHaveLength(1);
    } finally {
      await storage.close();
    }
  },
  60_000,
);
