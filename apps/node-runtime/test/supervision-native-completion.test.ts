import type {
  OperatingActionPlanV1,
  SupervisedResultDeliveryV2,
} from "@lervo/application-contract";
import { createHash } from "node:crypto";
import { canonicalJson } from "@lervo/event-contract";
import type { ConversationReplyCandidate } from "@lervo/interaction";
import { assertNativePublicationJudgement } from "../src/supervision-publication-judgement.js";
import { readSupervisionJsonArtifact } from "../src/supervision-artifact-json.js";
import type { ConversationOutboundMessage } from "@lervo/schemas";
import type { NodeSupervisionResultDeliveryConfiguration } from "../src/supervision-result-delivery.js";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { FileSystemCas } from "@lervo/cas";
import { readConversationOutboundText } from "@lervo/conversation-platform";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { listAssignments, listWorkspaces } from "@lervo/agent-workforce";
import {
  createRepositoryMandatePlan,
  installRepositoryMandate,
} from "../../cli/src/mandate-installation.js";
import {
  loadRepositoryKnowledgePolicy,
  createKnowledgeMigrationPlan,
  applyKnowledgeMigrationPlan,
  readCurrentWorkstreamState,
} from "@lervo/repository-knowledge";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { observeSupervisionTasks } from "../src/supervision-task-observation.js";
import { readSupervisedReviewFeedback } from "../src/supervision-review-observation.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";
import {
  configureNativeCompletionProvider,
  type NativeCompletionProviderVerdicts,
} from "./supervision-native-provider.fixture.js";
import { createSupervisionExpiryClock } from "./supervision-expiry-clock.fixture.js";

const roots: string[] = [];
const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface NativeCompletionVariation extends NativeCompletionProviderVerdicts {
  /** The owner completes after the original lease expired, as a settled v3 completion. */
  late?: true;
  /** One durable receipt append fails, so its round is uncertain until a restarted runtime. */
  receiptFailure?: {
    type: "assignment.completion.reconciled" | "assignment.reopened";
    occurrence: number;
    assignmentStatus: "leased" | "completed";
  };
  /** A transport without an origin conversation never sends the locally accepted result. */
  localTransport?: true;
  /** Another workstream becomes current while the owner completes its own bound goal. */
  parallelReview?: true;
  /** The owner publishes the accepted result through a transport whose first attempt fails. */
  publication?: true;
  /** The rejected writing review stays visible to a successor mandate; the run stops there. */
  stopAtWritingRejection?: true;
  /** A successor mandate is installed after the writing rejection and supervises the rest. */
  successorAfterWritingRejection?: true;
}

const reconciledFailure = {
  type: "assignment.completion.reconciled",
  occurrence: 1,
  assignmentStatus: "leased",
} as const;
const variations: Record<string, NativeCompletionVariation> = {
  normal: {
    writingRejections: 0,
    reviewRejections: 0,
    late: true,
    receiptFailure: reconciledFailure,
    localTransport: true,
    parallelReview: true,
  },
  rework: {
    writingRejections: 1,
    reviewRejections: 1,
    receiptFailure: { type: "assignment.reopened", occurrence: 2, assignmentStatus: "completed" },
    successorAfterWritingRejection: true,
  },
  publication_retry: { writingRejections: 0, reviewRejections: 0, publication: true },
  late_completion: { writingRejections: 0, reviewRejections: 0, late: true },
  late_recovery: {
    writingRejections: 0,
    reviewRejections: 0,
    late: true,
    receiptFailure: reconciledFailure,
  },
  recovery: { writingRejections: 0, reviewRejections: 0, receiptFailure: reconciledFailure },
  failed_writing: { writingRejections: 1, reviewRejections: 0, stopAtWritingRejection: true },
  writing_rework: { writingRejections: 1, reviewRejections: 0 },
  rework_receipt_failure: {
    writingRejections: 0,
    reviewRejections: 1,
    receiptFailure: { type: "assignment.reopened", occurrence: 1, assignmentStatus: "completed" },
  },
  local_transport: { writingRejections: 0, reviewRejections: 0, localTransport: true },
  parallel_review: { writingRejections: 0, reviewRejections: 0, parallelReview: true },
};

/** Owner decisions and supervision rounds implied by the rejected attempts before acceptance. */
function expectedNativeRun(variation: NativeCompletionVariation) {
  const attempts = 1 + variation.writingRejections + variation.reviewRejections;
  const operations = [
    ...Array.from({ length: variation.writingRejections }, () => [
      "prepare_completion",
      "request_rework",
    ]),
    ...Array.from({ length: variation.reviewRejections }, () => [
      "prepare_completion",
      "review_artifacts",
      "request_rework",
    ]),
  ].flat();
  operations.push("prepare_completion", "review_artifacts", "complete_workstream");
  if (variation.publication) operations.push("prepare_publication");
  // One dispatch round, two rounds per owner decision, and claim, workspace and dispatch per rework.
  const rounds = 1 + 2 * (operations.length - (variation.publication ? 1 : 0)) + 3 * (attempts - 1);
  const completions = attempts - variation.writingRejections;
  return { attempts, operations, rounds, completions };
}

async function recordParallelReview(
  f: Awaited<ReturnType<typeof dispatchFixture>>,
  storage: ProjectStorage,
) {
  const owner = (await readCurrentWorkstreamState(f.root))!;
  const id = hash(`review:${f.root}`).slice(7, 31);
  const eventIdentity = hash(`review-event:${f.root}`).slice(7, 39);
  const review = {
    ...owner.snapshot,
    workstreamId: `wks_${id}`,
    revision: 1,
    title: "Independent deployment review",
    objective: "Keep the installed routing approval held while the owner completes.",
    pendingApprovals: [
      {
        approvalId: `wapr_${id.slice(0, 16)}`,
        kind: "deployment" as const,
        summary: "Held until installed routing evidence is accepted.",
        bindingHash: hash("deployment-review"),
        blocking: true,
      },
    ],
  };
  const content = `${canonicalJson(review)}\n`;
  const artifact = await storage.artifacts.put(content);
  storage.events.append({
    eventId: `evt_${eventIdentity}`,
    projectId: storage.manifest.projectId,
    runId: `run_${eventIdentity}`,
    sessionId: `ses_${eventIdentity}`,
    type: "workstream.snapshot.recorded",
    schemaVersion: 1,
    occurredAt: review.updatedAt,
    actor: { kind: "agent", provider: "codex" },
    policyVersion: artifact.contentHash,
    payload: {
      workstreamId: review.workstreamId,
      revision: 1,
      status: "active",
      changeKind: "agent_start",
      snapshotArtifactId: `art_${artifact.contentHash.slice(7)}`,
      snapshotContentHash: artifact.contentHash,
      previousSnapshotContentHash: null,
      sourceArtifactId: null,
      sourceContentHash: null,
      recordedAt: review.updatedAt,
    },
  });
  await writeFile(resolve(f.root, ".lervo/state/workstreams/current.json"), content);
  return artifact.contentHash;
}

async function installSuccessorMandate(f: Awaited<ReturnType<typeof dispatchFixture>>) {
  const plan = await createRepositoryMandatePlan({
    root: f.root,
    mandate: {
      ...f.mandate,
      version: f.mandate.version + 1,
      maximumAttemptsPerAssignment: f.mandate.maximumAttemptsPerAssignment + 1,
    },
    supervisionId: f.binding.supervisionId,
    reviewerId: f.mandate.appointingAuthorityId,
  });
  const successor = await installRepositoryMandate({
    root: f.root,
    plan,
    approval: plan.approvalHash,
    reviewerId: f.mandate.appointingAuthorityId,
  });
  return { ...f.binding, mandateHash: successor.mandateHash };
}

/** A writing rejection leaves the assignment leased and stays readable under a successor mandate. */
async function installSuccessorAfterWritingRejection(
  f: Awaited<ReturnType<typeof dispatchFixture>>,
  storage: ProjectStorage,
  now: () => string,
) {
  const rejected = await new SupervisionTaskSource(storage, f.binding, now).read();
  expect(
    rejected.events.filter((event) => event.type === "work.supervision.review.recorded"),
  ).toMatchObject([{ payload: { verdict: "rework" } }]);
  expect(await listAssignments(f.root)).toMatchObject([{ status: "leased" }]);
  expect(
    storage.events
      .list({ limit: 1000 })
      .filter((event) => event.type === "assignment.completion.prepared"),
  ).toEqual([]);
  const binding = await installSuccessorMandate(f);
  const successorSource = await new SupervisionTaskSource(storage, binding, now).read();
  const observed = await observeSupervisionTasks(
    successorSource,
    storage.artifacts,
    binding,
    storage.events,
  );
  expect(observed.assignments[0]?.review).toMatchObject({ verdict: "rework" });
  const review = successorSource.supervisionEvents.findLast(
    (event) => event.type === "work.supervision.review.recorded",
  )!;
  expect(
    await readSupervisedReviewFeedback({
      events: storage.events,
      artifacts: storage.artifacts,
      candidate: review,
      authority: binding,
    }),
  ).toMatchObject({ reviewEventId: review.eventId, verdict: "rework" });
  return binding;
}

it.each(Object.keys(variations))(
  "completes native supervised work with exact semantic evidence (%s)",
  async (scenario) => {
    const variation = variations[scenario]!;
    const expected = expectedNativeRun(variation);
    const rework = expected.attempts > 1;
    const failure = variation.receiptFailure;
    let receiptFailures = 0;
    let recoveredReceiptFailures = 0;
    if (failure !== undefined) {
      const append = SQLiteEventStore.prototype.append;
      let occurrences = 0;
      vi.spyOn(SQLiteEventStore.prototype, "append").mockImplementation(function (
        this: SQLiteEventStore,
        draft,
      ) {
        if (draft.type === failure.type && ++occurrences === failure.occurrence) {
          receiptFailures++;
          throw new Error("fixture_event_failure");
        }
        return append.call(this, draft);
      });
    }
    const f = await dispatchFixture(
      roots,
      true,
      async (root) => {
        await writeFile(
          resolve(root, "AGENTS.md"),
          "Change only src/save.ts. Preserve the exported value.\n",
        );
        const policy = await loadRepositoryKnowledgePolicy(root);
        policy.normalization = { exclude: ["AGENTS.md"] };
        await writeFile(resolve(root, ".lervo/knowledge/policy.yaml"), JSON.stringify(policy));
        await applyKnowledgeMigrationPlan(
          await createKnowledgeMigrationPlan({ repositoryRoot: root }),
          new Date(),
          () => undefined,
        );
        return ["AGENTS.md", ".lervo/.gitignore"];
      },
      "developer",
      [
        "allocate_existing",
        "dispatch",
        "execute_as_owner",
        "publish_result",
        "request_rework",
        "revise_responsibility",
      ],
      undefined,
      // Leave the original lease outside the 120-second renewal window during fixture setup.
      // A near completion deadline still prevents renewal from extending that authority.
      variation.late ? 180_000 : undefined,
      variation.late ? 181_000 : undefined,
    );
    const log = resolve(f.login.context.homeDirectory, "native-operations.log");
    const promptLog = resolve(f.login.context.homeDirectory, "worker-prompt.log");
    await configureNativeCompletionProvider(f, variation, log, promptLog);
    const expiryClock = variation.late
      ? await createSupervisionExpiryClock(f.login.context.homeDirectory)
      : null;
    const storage = await openProjectStorage(f.root);
    const adapterArtifacts = await FileSystemCas.open(
      resolve(f.root, ".lervo/data/discord-result-artifacts"),
    );
    let clockOffset = 0;
    const now = () => new Date(Date.parse(f.ports.now()) + clockOffset).toISOString();
    const sent: ConversationOutboundMessage[] = [];
    const resultDelivery: NodeSupervisionResultDeliveryConfiguration = {
      adapterArtifacts,
      origin: {
        sourceEventId: `cve_${"3".repeat(64)}`,
        policyId: `cpp_${"4".repeat(64)}`,
        target: {
          integrationId: "itg_nativepublication",
          projectId: storage.manifest.projectId,
          conversationId: "cnv_nativepublication",
          threadId: null,
        },
        actor: { kind: "agent", participantId: "ptc_nativeowner", roleId: f.owner.roleId },
      },
      adapter: {
        descriptor: {
          schemaVersion: 1,
          integrationId: "itg_nativepublication",
          adapterKind: "discord",
          instanceIdentityHash: `sha256:${"c".repeat(64)}`,
          capabilities: ["messages.send"],
        },
        deliver: async (outbound) => {
          expect(
            await readConversationOutboundText({
              message: outbound,
              artifactStore: adapterArtifacts,
            }),
          ).toContain("saved value");
          sent.push(structuredClone(outbound));
          if (sent.length === 1) throw new Error("fixture_transport_failure");
          return {
            schemaVersion: 1,
            outboundId: outbound.outboundId,
            integrationId: outbound.target.integrationId,
            deliveryKeyHash: `sha256:${"d".repeat(64)}`,
            deliveredAt: now(),
          };
        },
      },
    };
    const { origin: _origin, ...localDelivery } = resultDelivery;
    let binding = f.binding;
    const openRuntime = () =>
      openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding,
        ports: { now, recordAttention: f.ports.recordAttention },
        ...(variation.publication
          ? { resultDelivery }
          : variation.localTransport
            ? { resultDelivery: localDelivery }
            : {}),
        ownerReasoning: { provider: "codex", reservedTokens: 100 },
        runtimeReadiness: f.runtimeReadiness,
        managedExecution: {
          nodeExecutable: process.execPath,
          cliBundle: resolve("apps/cli/dist/bin.js"),
        },
      });
    let runtime = await openRuntime();
    try {
      const cycles = [];
      let selectedReviewHash: string | null = null;
      for (let i = 0; i < expected.rounds; i++) {
        if (i === 2 && variation.stopAtWritingRejection) {
          expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
          await runtime.close();
          await installSuccessorAfterWritingRejection(f, storage, now);
          return;
        }
        if (i === 1 && variation.late) {
          await expiryClock!.advancePast(f.assignment.lease!.expiresAt);
        }
        let cycle = await runtime.runCycle();
        if (receiptFailures > recoveredReceiptFailures) {
          expect(cycle.disposition).toBe("uncertain");
          expect(await listAssignments(f.root)).toMatchObject([
            { status: failure!.assignmentStatus },
          ]);
          await runtime.close();
          runtime = await openRuntime();
          cycle = await runtime.runCycle();
          recoveredReceiptFailures++;
        }
        cycles.push(cycle);
        expect(cycle.disposition, JSON.stringify({ cycles, attention: f.attention })).toBe(
          "effect_confirmed",
        );
        if (variation.parallelReview && selectedReviewHash === null) {
          const accepted = storage.events
            .list({ limit: 1000 })
            .some(
              (event) =>
                event.type === "work.supervision.review.recorded" &&
                event.payload.verdict === "accepted",
            );
          if (accepted) selectedReviewHash = await recordParallelReview(f, storage);
        }
        if (i === 2 && variation.successorAfterWritingRejection) {
          await runtime.close();
          binding = await installSuccessorAfterWritingRejection(f, storage, now);
          runtime = await openRuntime();
        }
        if (i === 1 || i === 3 || (rework && i === 6)) {
          await runtime.close();
          runtime = await openRuntime();
        }
      }
      expect(receiptFailures).toBe(failure === undefined ? 0 : 1);
      expect(recoveredReceiptFailures).toBe(receiptFailures);
      if (variation.publication) {
        for (let i = 0; i < 2; i++)
          expect((await runtime.runCycle()).disposition, JSON.stringify(f.attention)).toBe(
            "effect_confirmed",
          );
        const calls = await readFile(log, "utf8");
        const workerPrompts = await readFile(promptLog, "utf8");
        expect(sent).toHaveLength(0);
        await runtime.runCycle();
        expect(sent).toHaveLength(1);
        await runtime.close();
        runtime = await openRuntime();
        clockOffset += 5100;
        await runtime.runCycle();
        expect(sent).toHaveLength(2);
        expect(sent[1]).toEqual(sent[0]);
        expect(await readFile(log, "utf8")).toBe(calls);
        expect(await readFile(promptLog, "utf8")).toBe(workerPrompts);
        const state = await new SupervisionTaskSource(storage, binding, now).read();
        const queued = state.events.findLast(
          (event) => event.type === "work.supervision.delivery.queued",
        )!;
        const publicationPlan = (await readSupervisionJsonArtifact(
          storage.artifacts,
          String(queued.payload.planHash),
        )) as OperatingActionPlanV1;
        const effect = (await readSupervisionJsonArtifact(
          storage.artifacts,
          publicationPlan.effectHash,
        )) as SupervisedResultDeliveryV2;
        expect(effect.schemaVersion).toBe(2);
        const candidate = (await readSupervisionJsonArtifact(
          storage.artifacts,
          effect.candidateArtifactHash,
        )) as ConversationReplyCandidate;
        const completionPlan = (await readSupervisionJsonArtifact(
          storage.artifacts,
          effect.completionPlanHash,
        )) as OperatingActionPlanV1;
        await expect(
          assertNativePublicationJudgement({
            ...storage,
            completionPlan,
            candidate,
            effect: { ...effect, reasoningResultHash: effect.resultArtifactHash },
          }),
        ).rejects.toThrow(/semantic model result/iu);

        expect(
          (await new SupervisionTaskSource(storage, binding, now).read()).events
            .filter((event) => event.type === "work.supervision.delivery.observed")
            .map((event) => event.payload.status),
        ).toEqual(["failed", "delivered"]);
      }
      if (variation.parallelReview) {
        expect(selectedReviewHash).not.toBeNull();
        expect((await readCurrentWorkstreamState(f.root))?.contentHash).toBe(selectedReviewHash);
      } else expect((await readCurrentWorkstreamState(f.root))?.snapshot.status).toBe("completed");
      if (!variation.publication) {
        const calls = await readFile(log, "utf8");
        for (let i = 0; i < 2; i++) expect((await runtime.runCycle()).disposition).toBe("idle");
        expect(await readFile(log, "utf8")).toBe(calls);
        if (variation.localTransport) {
          expect(sent).toEqual([]);
          await runtime.close();
          runtime = await openRuntime();
          expect((await runtime.runCycle()).report).toMatchObject({
            reasonCode: "accepted_local_result_available",
            nextAction: null,
          });
          expect(await readFile(log, "utf8")).toBe(calls);
        }
      }
      expect(await listAssignments(f.root)).toMatchObject([{ status: "completed", lease: null }]);
      expect((await readFile(log, "utf8")).trim().split("\n")).toEqual(expected.operations);
      const source = await new SupervisionTaskSource(storage, binding, f.ports.now).read();
      const plans = await Promise.all(
        source.events
          .filter((event) => event.type === "work.supervision.decision.recorded")
          .map(
            (event) =>
              readSupervisionJsonArtifact(
                storage.artifacts,
                String(event.payload.planArtifactHash),
              ) as Promise<OperatingActionPlanV1>,
          ),
      );
      const dispatched = plans.filter(
        (plan) => plan.effectContract === "work.managed_execution.v1",
      );
      expect(dispatched.length).toBeGreaterThan(0);
      // The worker is capped at its reservation, so it carries the reviewed attempt budget
      // rather than the owner reasoning reservation of 100.
      for (const plan of dispatched)
        expect(plan.reservedTokens).toBe(f.mandate.maximumAttemptTokens);
      if (variation.late) {
        expect(
          plans.filter((plan) => plan.effectContract === "work.assignment_completion.v3"),
        ).toHaveLength(1);
        expect(
          source.events.filter((event) => event.type === "assignment.lease.renewed"),
        ).toHaveLength(0);
      }
      expect(source.execution.attempts).toMatchObject(
        Array.from({ length: expected.attempts }, (_, index) => ({
          attemptOrdinal: index + 1,
          relationship: index === 0 ? "root" : "retry",
        })),
      );
      expect(new Set(source.execution.attempts.map((attempt) => attempt.workId)).size).toBe(1);
      expect(source.events.filter((event) => event.type === "assignment.reopened")).toHaveLength(
        expected.attempts - 1,
      );
      if (rework) {
        const workspaces = await listWorkspaces(f.root);
        expect(workspaces).toHaveLength(expected.attempts);
        expect(workspaces.map((item) => item.leaseGeneration).sort()).toEqual(
          Array.from({ length: expected.attempts }, (_, index) => index + 1),
        );
        expect(new Set(workspaces.map((item) => item.ownerWorkspacePath)).size).toBe(
          expected.attempts,
        );
        for (const workspace of workspaces)
          expect(
            await readFile(resolve(workspace.ownerWorkspacePath!, "src/save.ts"), "utf8"),
          ).toContain("verified");
      }
      expect(source.workstreamResources.groups).toMatchObject([
        {
          completeness: "complete",
          // Every owner decision and every worker attempt reports 50 provider tokens.
          totalTokens: 50 * (expected.operations.length + expected.attempts),
        },
      ]);
      expect(
        source.events.filter((event) => event.type === "assignment.completion.prepared"),
      ).toHaveLength(expected.completions);
      expect(
        source.events.filter((event) => event.type === "assignment.completion.reconciled"),
      ).toHaveLength(expected.completions);
      expect(await readFile(resolve(f.workspacePath, "src/save.ts"), "utf8")).toContain("verified");
    } finally {
      await runtime.close();
      await storage.close();
      expiryClock?.close();
    }
  },
  300_000,
);
