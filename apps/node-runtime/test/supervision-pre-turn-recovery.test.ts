import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import {
  managedExecutionIdentity,
  operatingContractHash,
  supervisedManagedExecutionFields,
} from "@lervo/work-controller";
import type {
  OperatingActionPlanV1,
  SupervisedManagedExecutionV1,
} from "@lervo/application-contract";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { readProvenPreTurnFailure } from "../src/supervision-pre-turn-failure-source.js";
import { recoverInterruptedPreTurn } from "../src/supervision-pre-turn-recovery.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";
import { recordPreparedWorkspaceFixture } from "./supervision-prepared-workspace.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const HASH = `sha256:${"a".repeat(64)}`;
const STARTED = Date.parse("2026-09-12T23:13:09.000Z");

it("settles a pre-turn interruption fenced by a completed host boot", async () => {
  const f = await dispatchFixture(roots, true, undefined, "developer", [
    "dispatch",
    "execute_as_owner",
  ]);
  await recordPreparedWorkspaceFixture(f);
  const storage = await openProjectStorage(f.root);
  try {
    const effect: SupervisedManagedExecutionV1 = {
      schemaVersion: 1,
      kind: "work.managed_execution",
      responsibility: f.task,
      leaseId: f.assignment.lease!.leaseId,
      provider: "codex",
      instructions: "Read src/save.ts and verify its saved value.",
      risk: "low",
      reservedTokens: 100,
    };
    await storage.artifacts.put(canonicalJson(effect));
    const propose = f.ports.propose;
    let plan: OperatingActionPlanV1 | null = null;
    f.ports.propose = async (report) =>
      (plan = { ...(await propose(report))!, ...supervisedManagedExecutionFields(effect) });
    const admission = f.ports.readAdmission;
    f.ports.readAdmission = async (action) => ({
      ...(await admission(action)),
      effectMappings: [{ actionKind: "dispatch", contract: "work.managed_execution.v1" }],
    });
    const readiness = f.ports.readWorkerReadiness;
    f.ports.readWorkerReadiness = async (action) => {
      const result = await readiness(action);
      result.observation.checks.find((check) => check.kind === "knowledge")!.status = "unobserved";
      return result;
    };
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    try {
      await runtime.runCycle();
    } finally {
      await runtime.close();
    }
    // A callback assignment does not narrow the declared type, so guard instead of asserting.
    if (plan === null) throw new Error("The fixture recorded no managed decision.");
    const action = plan as OperatingActionPlanV1;
    const identity = managedExecutionIdentity(action.projectId, operatingContractHash(action));
    const at = (offsetMs: number) => new Date(STARTED + offsetMs).toISOString();
    type Draft = Parameters<typeof storage.events.append>[0];
    const append = (
      index: number,
      type: Draft["type"],
      offsetMs: number,
      payload: Draft["payload"],
    ) =>
      storage.events.append({
        eventId: `evt_${operatingContractHash({ kind: type, index, ...identity }).slice(7, 39)}`,
        projectId: action.projectId,
        ...identity,
        schemaVersion: 3,
        type,
        occurredAt: at(offsetMs),
        actor: { kind: "system" },
        policyVersion: action.mandateHash,
        payload,
      });
    // Exactly the pre-start prefix: the reboot killed the request before any provider turn.
    append(0, "managed.execution.reserved", 0, {
      executionKey: operatingContractHash(action),
      requestHash: operatingContractHash("request"),
    });
    append(1, "work.causality.recorded", 1000, {
      workId: `wrk_${"1".repeat(24)}`,
      executionContractVersion: 1,
      relationship: "root",
      parentRunId: null,
      retryOfRunId: null,
      attemptOrdinal: 1,
      workstreamId: null,
      assignmentId: null,
      agentId: null,
    });
    append(2, "run.requested", 2000, {});
    append(3, "run.resolved", 3000, {});
    append(4, "role.input.bound", 4000, {
      schemaVersion: 1,
      roleId: "developer",
      roleContractHash: HASH,
      inputContractId: "role.input.v1",
      inputArtifactHash: HASH,
      inputByteCount: 512,
    });
    const observedAt = at(600_000);
    const witness = {
      schemaVersion: 1 as const,
      kind: "host.boot_transition_witness" as const,
      incidentAt: at(4000),
      incidentBootId: "a".repeat(32),
      incidentBootFirstAt: at(-1000),
      incidentBootLastAt: at(60_000),
      successorBootId: "b".repeat(32),
      successorBootFirstAt: at(120_000),
      currentBootId: "c".repeat(32),
      inventorySha256: `sha256:${"e".repeat(64)}`,
      observedAt,
    };
    const result = await recoverInterruptedPreTurn({
      repositoryRoot: f.root,
      binding: f.binding,
      runId: identity.runId,
      now: () => observedAt,
      observeWitness: () => witness,
      currentBoot: () => witness.currentBootId,
    });
    const events = collectRunEventsBounded({
      events: storage.events,
      runId: identity.runId,
      maximumEvents: 64,
    });
    const terminal = events.find((event) => event.type === "run.failed");
    expect(terminal?.eventId).toBe(result.eventId);
    expect(terminal?.payload).toEqual({
      failureCode: "interrupted_before_turn",
      retryable: true,
      diagnosticDigest: result.diagnosticDigest,
    });
    expect(await readProvenPreTurnFailure(events, storage.artifacts)).toBe(true);
    expect(events.filter((event) => event.type === "adapter.started")).toHaveLength(0);
  } finally {
    await storage.close();
  }
}, 60_000);
