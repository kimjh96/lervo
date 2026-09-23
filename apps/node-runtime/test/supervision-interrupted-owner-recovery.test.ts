import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalJson } from "@lervo/event-contract";
import type {
  OperatingActionPlanV1,
  SupervisedOwnerReasoningV1,
} from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  loadRepositoryKnowledgePolicy,
} from "@lervo/repository-knowledge";
import {
  managedExecutionIdentity,
  operatingContractHash,
  projectWorkstreamResources,
  supervisedOwnerReasoningFields,
} from "@lervo/work-controller";

import { createLoginFixture } from "../../../packages/adapter-contract/test/login.fixture.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { inspectOwnerReasoning } from "../src/supervision-reasoning-receipt.js";
import { createOwnerReasoningContext } from "../src/supervision-reasoning-context.js";
import { SupervisionOwnerReasoningEffects } from "../src/supervision-reasoning-effects.js";
import { reconcileInterruptedOwnerReasoning } from "../src/supervision-interrupted-owner-recovery.js";
import { readInterruptedOwnerResourceSource } from "../src/supervision-interrupted-owner-resources.js";
import { readProvenInterruptedOwnerReasoning } from "../src/supervision-interrupted-owner-source.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { observeSupervisionTaskResources } from "../src/supervision-task-resources.js";
import { supervisionFixture } from "./supervision.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("reconciles one terminal owner interruption and keeps its full unknown-spend reservation", async () => {
  const login = await createLoginFixture(roots);
  const f = await supervisionFixture(
    roots,
    async (root) => {
      await writeFile(resolve(root, "AGENTS.md"), "Preserve canonical work evidence.\n");
      const policy = await loadRepositoryKnowledgePolicy(root);
      policy.normalization = { exclude: ["AGENTS.md"] };
      await writeFile(resolve(root, ".lervo/knowledge/policy.yaml"), JSON.stringify(policy));
      await applyKnowledgeMigrationPlan(
        await createKnowledgeMigrationPlan({ repositoryRoot: root }),
        new Date(),
        () => undefined,
      );
      for (const args of [
        ["init"],
        ["config", "user.name", "Lervo Test"],
        ["config", "user.email", "test@example.invalid"],
        ["add", "AGENTS.md"],
        ["commit", "-m", "fixture"],
      ])
        await promisify(execFile)("git", ["-C", root, ...args]);
    },
    "developer",
    ["allocate_existing", "execute_as_owner"],
  );
  const storage = await openProjectStorage(f.root);
  const sourceReader = new SupervisionTaskSource(storage, f.binding, f.ports.now);
  let plan: OperatingActionPlanV1 | undefined;
  let attemptNumber = 1;
  vi.spyOn(SupervisionOwnerReasoningEffects.prototype, "execute").mockImplementation(async () => {
    throw new Error("fixture_provider_process_lost");
  });
  const runtime = await openNodeOutcomeSupervisionRuntime({
    repositoryRoot: f.root,
    binding: f.binding,
    ownerReasoning: { provider: "codex", reservedTokens: 100 },
    runtimeReadiness: {
      providerExecutables: { codex: login.executable },
      providerLoginContexts: { codex: login.context },
      verificationTools: {},
    },
    ports: {
      now: f.ports.now,
      recordAttention: f.ports.recordAttention,
      propose: async (report) => {
        const source = await sourceReader.read();
        const context = await createOwnerReasoningContext({
          storage,
          binding: f.binding,
          source,
          report,
          expectedPaths: ["src"],
          now: f.ports.now,
        });
        const effect: SupervisedOwnerReasoningV1 = {
          schemaVersion: 1,
          kind: "work.owner_reasoning",
          basisHash: context.context.basisHash,
          contextArtifactHash: context.artifact.contentHash,
          roleId: f.owner.roleId,
          roleVersion: f.owner.roleVersion,
          roleContractHash: f.owner.roleContractHash,
          provider: "codex",
          requestedModel: null,
          reservedTokens: f.mandate.maximumAttemptTokens,
          attemptNumber,
          deadline: new Date(Date.now() + 120_000).toISOString(),
        };
        await storage.artifacts.put(canonicalJson(effect));
        const rationale = await storage.artifacts.put(canonicalJson("Inspect the bounded goal."));
        plan = {
          schemaVersion: 1,
          ...f.binding,
          projectId: f.owner.projectId,
          teamId: f.mandate.teamIds[0]!,
          graphHash: source.graph.graphHash,
          sourceRevisionDigest: report.sourceRevisionDigest,
          causationEventIds: report.causationEventIds,
          rationaleArtifactHash: rationale.contentHash,
          ...supervisedOwnerReasoningFields(effect),
        };
        return plan;
      },
    },
  });
  try {
    expect((await runtime.runCycle()).disposition).toBe("uncertain");
    expect(plan).toBeDefined();
    const action = plan!;
    const identity = managedExecutionIdentity(action.projectId, operatingContractHash(action));
    const startedAt = Date.now();
    const at = (offset: number) => new Date(startedAt + offset).toISOString();
    const workId = `wrk_${"a".repeat(24)}`;
    type Draft = Parameters<typeof storage.events.append>[0];
    const append = (
      index: number,
      type: Draft["type"],
      payload: Draft["payload"],
      actor: Draft["actor"] = { kind: "system" },
      target: typeof identity = identity,
      occurredAtOffsetMs = index * 1000,
    ) =>
      storage.events.append({
        eventId: `evt_${operatingContractHash({ type, index, ...target }).slice(7, 39)}`,
        projectId: action.projectId,
        ...target,
        schemaVersion:
          type === "managed.execution.reserved"
            ? 3
            : [
                  "work.causality.recorded",
                  "provider.process.observed",
                  "resource.usage.recorded",
                  "execution.stages.observed",
                ].includes(type)
              ? 2
              : 1,
        type,
        occurredAt: at(occurredAtOffsetMs),
        actor,
        policyVersion: action.mandateHash,
        payload,
      } as Draft).event;
    append(0, "managed.execution.reserved", {
      executionKey: operatingContractHash(action),
      requestHash: action.effectHash,
    });
    append(1, "work.causality.recorded", {
      workId,
      executionContractVersion: 1,
      relationship: "root",
      parentRunId: null,
      retryOfRunId: null,
      attemptOrdinal: 1,
      workstreamId: action.workstreamId,
      assignmentId: null,
      agentId: action.ownerAgentId,
    });
    append(2, "run.requested", {});
    append(3, "run.resolved", {});
    append(
      4,
      "adapter.started",
      {
        adapterId: "lervo/codex",
        adapterVersion: "0.1.0",
        providerSessionId: "01a0cfcd-e368-7360-8706-c7ed72b6fb66",
        executionMode: "read_only",
      },
      { kind: "provider", provider: "codex" },
    );
    append(
      5,
      "provider.process.observed",
      {
        adapterId: "lervo/codex",
        providerSessionDigest: `sha256:${"b".repeat(64)}`,
        phase: "session_started",
        status: "running",
        evidence: "owned_process_state",
        observedAt: at(5000),
        releasesAgentAuthority: false,
        releasesAssignmentAuthority: false,
        provesWorkProgress: false,
      },
      { kind: "provider", provider: "codex" },
    );
    append(6, "context.injected", {
      receiptId: "ctx_interrupted",
      evidenceReceiptIds: ["ctx_interrupted"],
      envelopeId: "envelope-interrupted",
      documentIds: ["doc_interrupted"],
      targetTurnId: "turn-interrupted",
      contextGeneration: 0,
    });
    append(
      7,
      "resource.usage.recorded",
      {
        workId,
        resourceObservationId: `ruo_${"a".repeat(24)}`,
        sourceCoordinateDigest: `sha256:${"c".repeat(64)}`,
        scope: "primary_provider",
        source: "provider_reported",
        accountingMode: "turn_cumulative",
        accountingDescriptorHash: `sha256:${"d".repeat(64)}`,
        modelIdentity: {
          provider: "codex",
          requestedModel: null,
          answerModel: null,
          observedModelIds: [],
          answerModelEvidence: "unavailable",
          unavailableReason: "provider_model_unavailable",
        },
        status: "unavailable",
        usage: null,
        reasonCode: "resource_observation_missing",
      },
      { kind: "provider", provider: "codex" },
    );
    append(8, "run.failed", {
      failureCode: "provider_stop_failed",
      retryable: false,
      diagnosticDigest: `sha256:${"e".repeat(64)}`,
    });
    expect(await inspectOwnerReasoning(storage, action)).toMatchObject({ status: "uncertain" });
    const observedAt = at(120_000);
    const witness = {
      schemaVersion: 1 as const,
      kind: "host.unit_invocation_witness" as const,
      unit: "lervo-node-fixture.service",
      incidentAt: at(8000),
      incidentInvocationId: "1".repeat(32),
      incidentInvocationFirstAt: at(-1000),
      incidentInvocationLastAt: at(60_000),
      successorInvocationId: "2".repeat(32),
      successorInvocationFirstAt: at(60_000),
      currentInvocationId: "3".repeat(32),
      inventorySha256: `sha256:${"f".repeat(64)}`,
      observedAt,
    };
    await expect(
      reconcileInterruptedOwnerReasoning({
        repositoryRoot: f.root,
        binding: f.binding,
        runId: identity.runId,
        unit: witness.unit,
        now: () => observedAt,
        observeWitness: () => witness,
        currentInvocation: () => "4".repeat(32),
      }),
    ).rejects.toThrow("evidence changed");
    expect(
      storage.events
        .list()
        .filter(
          (event) => event.type === "work.supervision.owner_reasoning.interruption_reconciled",
        ),
    ).toHaveLength(0);
    const result = await reconcileInterruptedOwnerReasoning({
      repositoryRoot: f.root,
      binding: f.binding,
      runId: identity.runId,
      unit: witness.unit,
      now: () => observedAt,
      observeWitness: () => witness,
      currentInvocation: () => witness.currentInvocationId,
    });
    expect(result.eventId).toMatch(/^evt_[a-f0-9]{32}$/u);
    expect(
      (await readProvenInterruptedOwnerReasoning({ storage, plan: action }))?.reconciliation
        .eventId,
    ).toBe(result.eventId);
    expect(await inspectOwnerReasoning(storage, action)).toMatchObject({ status: "confirmed" });
    await expect(runtime.runCycle()).resolves.toBeDefined();
    expect(
      storage.events
        .list()
        .filter(
          (event) =>
            event.type === "work.supervision.effect.observed" &&
            event.payload.status === "effect_confirmed" &&
            (event.payload.effectEventIds as string[]).includes(result.eventId),
        ),
    ).toHaveLength(1);
    const source = await sourceReader.read();
    expect(source.reconciledRunIds).toEqual([identity.runId]);
    expect(source.workstreamResources.groups).toEqual([]);
    expect(
      projectWorkstreamResources({
        events: source.events,
        workstreamId: action.workstreamId,
        ...(source.scopeAnchor === undefined ? {} : { scopeAnchor: source.scopeAnchor }),
      }),
    ).not.toEqual(source.workstreamResources);
    expect(
      (
        await readInterruptedOwnerResourceSource({
          storage,
          events: source.events.filter((event) => event.runId !== "run_future_owner_attempt"),
          workstreamId: action.workstreamId,
          ...(source.scopeAnchor === undefined ? {} : { scopeAnchor: source.scopeAnchor }),
        })
      ).workstreamResources,
    ).toEqual(source.workstreamResources);
    expect(
      await observeSupervisionTaskResources({
        source,
        artifacts: storage.artifacts,
        events: storage.events,
        plan: { ...action, attemptNumber: 2 },
      }),
    ).toMatchObject({
      observedAggregateTokens: 0,
      reservedAggregateTokens: action.reservedTokens,
      activeAttempts: 0,
      resourceAdmission: "within",
    });
    await expect(
      reconcileInterruptedOwnerReasoning({
        repositoryRoot: f.root,
        binding: f.binding,
        runId: identity.runId,
        unit: witness.unit,
        now: () => observedAt,
        observeWitness: () => witness,
        currentInvocation: () => witness.currentInvocationId,
      }),
    ).rejects.toThrow();
    expect(
      storage.events
        .list()
        .filter(
          (event) => event.type === "work.supervision.owner_reasoning.interruption_reconciled",
        ),
    ).toHaveLength(1);
    attemptNumber = 2;
    expect((await runtime.runCycle()).disposition).toBe("uncertain");
    expect(plan?.attemptNumber).toBe(2);
    const second = plan!;
    const secondIdentity = managedExecutionIdentity(
      second.projectId,
      operatingContractHash(second),
    );
    append(
      11,
      "managed.execution.reserved",
      { executionKey: operatingContractHash(second), requestHash: second.effectHash },
      { kind: "system" },
      secondIdentity,
      141_000,
    );
    append(
      12,
      "work.causality.recorded",
      {
        workId,
        executionContractVersion: 1,
        relationship: "retry",
        parentRunId: identity.runId,
        retryOfRunId: identity.runId,
        attemptOrdinal: 2,
        workstreamId: second.workstreamId,
        assignmentId: null,
        agentId: second.ownerAgentId,
      },
      { kind: "system" },
      secondIdentity,
      142_000,
    );
    append(13, "run.requested", {}, { kind: "system" }, secondIdentity, 143_000);
    append(14, "run.resolved", {}, { kind: "system" }, secondIdentity, 144_000);
    const oldUsage = storage.events
      .list()
      .find((event) => event.runId === identity.runId && event.type === "resource.usage.recorded")!;
    append(
      15,
      "resource.usage.recorded",
      { ...oldUsage.payload, resourceObservationId: `ruo_${"b".repeat(24)}` },
      { kind: "provider", provider: "codex" },
      secondIdentity,
      145_000,
    );
    append(
      16,
      "execution.stages.observed",
      {
        executionMode: "managed",
        workId,
        terminalObservationId: null,
        terminalHook: null,
        observationSetId: `stgobs_${"c".repeat(24)}`,
        stageCatalogVersion: 2,
        environmentProfileDigest: `sha256:${"d".repeat(64)}`,
        repositoryProfile: "small",
        stages: [
          {
            stageId: "total",
            parentStageId: null,
            durationMs: 1,
            budgetMs: null,
            outcome: "failed",
            coldState: "unknown",
          },
        ],
      },
      { kind: "system" },
      secondIdentity,
      146_000,
    );
    append(
      17,
      "run.failed",
      {
        failureCode: "provider_start_failed",
        retryable: false,
        diagnosticDigest: `sha256:${"e".repeat(64)}`,
      },
      { kind: "system" },
      secondIdentity,
      147_000,
    );
    expect(await inspectOwnerReasoning(storage, second)).toMatchObject({ status: "uncertain" });
    const secondAt = at(152_000);
    const secondWitness = {
      ...witness,
      incidentAt: at(147_000),
      incidentInvocationId: "4".repeat(32),
      incidentInvocationFirstAt: at(130_000),
      incidentInvocationLastAt: at(150_000),
      successorInvocationId: "5".repeat(32),
      successorInvocationFirstAt: at(151_000),
      currentInvocationId: "6".repeat(32),
      observedAt: secondAt,
    };
    const secondResult = await reconcileInterruptedOwnerReasoning({
      repositoryRoot: f.root,
      binding: f.binding,
      runId: secondIdentity.runId,
      unit: secondWitness.unit,
      now: () => secondAt,
      observeWitness: () => secondWitness,
      currentInvocation: () => secondWitness.currentInvocationId,
    });
    expect(
      (await readProvenInterruptedOwnerReasoning({ storage, plan: second }))?.reconciliation
        .eventId,
    ).toBe(secondResult.eventId);
    expect(await inspectOwnerReasoning(storage, second)).toMatchObject({ status: "confirmed" });
    await expect(runtime.runCycle()).resolves.toBeDefined();
    expect((await sourceReader.read()).reconciledRunIds).toEqual(
      [identity.runId, secondIdentity.runId].sort(),
    );
  } finally {
    await runtime.close();
    await storage.close();
  }
}, 60_000);
