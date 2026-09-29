import { canonicalJson } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
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
import type { dispatchFixture } from "./supervision-dispatch.fixture.js";

const HASH = `sha256:${"a".repeat(64)}`;

/**
 * Records the exact shape of a managed run whose owning process died after its provider session
 * opened: an admitted decision, the five-event pre-start prefix, a read-only adapter start, one
 * observation proving no work, and injected context. No usage, stop or terminal event is written.
 */
export async function recordAbandonedManagedRun(input: {
  fixture: Awaited<ReturnType<typeof dispatchFixture>>;
  storage: ProjectStorage;
  startedAt: number;
}) {
  const { fixture: f, storage } = input;
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
  // Readiness blocks the launch, so the decision is admitted and recorded with no provider start.
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
  if (plan === null) throw new Error("The fixture recorded no managed decision.");
  const action = plan as OperatingActionPlanV1;
  const identity = managedExecutionIdentity(action.projectId, operatingContractHash(action));
  const at = (offsetMs: number) => new Date(input.startedAt + offsetMs).toISOString();
  type Draft = Extract<Parameters<typeof storage.events.append>[0], { schemaVersion: 3 }>;
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
  append(5, "adapter.started", 23_000, {
    adapterId: "lervo/codex",
    adapterVersion: "0.1.0",
    providerSessionId: "01a0a344-6f26-7671-906a-c2e5aff6e21c",
    executionMode: "read_only",
  });
  append(6, "provider.process.observed", 23_100, {
    adapterId: "lervo/codex",
    providerSessionDigest: HASH,
    phase: "session_started",
    status: "running",
    evidence: "owned_process_state",
    observedAt: at(23_100),
    releasesAgentAuthority: false,
    releasesAssignmentAuthority: false,
    provesWorkProgress: false,
  });
  append(7, "context.injected", 30_000, {
    receiptId: "ctx_abandoned01",
    evidenceReceiptIds: ["ctx_abandoned01"],
    envelopeId: "envelope-abandoned",
    documentIds: ["doc_abandoned0001"],
    targetTurnId: "turn-abandoned",
    contextGeneration: 0,
  });
  return { action, identity, lastEventAt: at(30_000) };
}
