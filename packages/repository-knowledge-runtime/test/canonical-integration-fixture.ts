import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonicalJson,
  processKnowledgeConvergence,
  sha256,
  stableId,
  type KnowledgeConvergenceHost,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
  type KnowledgeConvergenceStatus,
} from "@lervo/repository-knowledge";
import { knowledgeConvergenceStages, type KnowledgeConvergenceStage } from "@lervo/schemas";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { assessCanonicalBaseline } from "../src/canonical-assessment.js";
import { integrateCanonicalBaseline } from "../src/canonical-integration-stage.js";
import { reviewCanonicalBaseline, type CanonicalBatch } from "../src/canonical-review.js";
import {
  assertConvergenceSourceCurrent,
  assertConvergenceSourceExact,
  createConvergenceRuntimeHost,
} from "../src/host.js";
import { convergenceSourceObservation } from "../src/source-observation.js";
import { completeConvergenceStage } from "../src/stage-receipt.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import {
  CANONICAL_SOURCE,
  CANONICAL_TARGET,
  INTEGRATED_REQUIREMENT,
  reviewedRuntimeDraft,
} from "./canonical-integration-provider.js";
import { fixture } from "./fixture.js";

export { CANONICAL_SOURCE, CANONICAL_TARGET, INTEGRATED_REQUIREMENT };

const SETTLED_STATES: readonly KnowledgeConvergenceStatus["state"][] = [
  "idle",
  "attention_required",
  "recovery_required",
  "waiting_authority",
  "retry_scheduled",
];

/**
 * A real repository, delegation and integration ref whose observed runtime source asks for one
 * reviewed specification draft. Two ways reach `canonical_integration`:
 *
 * - `integrate()` calls the stage directly with a hand-opened obligation and a reviewed draft, for
 *   cases that observe only the stage.
 * - `converge()` runs the real convergence owner over the real runtime host: discovery, fences,
 *   dependency evaluation, assessment, review and canonical integration are product code. The
 *   test file's `vi.mock` replaces `reviewKnowledgeJson`, and with it provider admission and the
 *   batch budget reservation inside it.
 *
 * Normalization stages and lifecycle verification are receipt stand-ins, so this fixture guards
 * neither normalization nor lifecycle behavior, including parking and readmission, and it does
 * not produce the normalized documents that later review context depends on. The kept worker
 * case "parks a source whose draft meets a dirty canonical target and readmits it…" and
 * `workspace-recovery.test.ts` cover those paths end to end.
 */
export async function canonicalIntegrationFixture(
  options: { integrationRef?: "present" | "absent"; ownerTargetEdit?: string } = {},
) {
  const f = await fixture(true, true);
  if (options.integrationRef === "absent")
    execFileSync("git", ["-C", f.root, "branch", "-D", "knowledge-integration"]);
  await writeFile(
    resolve(f.root, CANONICAL_SOURCE),
    "export const maximumBackgroundCalls = 2; // observed runtime limit\n",
  );
  const targetPath = resolve(f.root, CANONICAL_TARGET);
  if (options.ownerTargetEdit !== undefined)
    await writeFile(targetPath, `${await readFile(targetPath, "utf8")}${options.ownerTargetEdit}`);
  // The runtime host's own exact and current fences guard every effect, as in a worker turn.
  const context: ConvergenceRuntimeContext = {
    storage: f.storage,
    provider: "claude",
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSourceExact: (input) => assertConvergenceSourceExact(context, input),
    assertSourceCurrent: (input) => assertConvergenceSourceCurrent(context, input),
  };
  const runtime = createConvergenceRuntimeHost(context);
  const host: KnowledgeConvergenceHost = {
    ...runtime,
    runStage: (stage, state, assertLease) => {
      if (stage === "assessment") return assessCanonicalBaseline(context, state, assertLease);
      if (stage === "canonical_review") return reviewCanonicalBaseline(context, state, assertLease);
      if (stage === "canonical_integration") return runtime.runStage(stage, state, assertLease);
      if (stage === "lifecycle_verification") return settleLifecycle(context, state);
      return settleReceipt(context, state, stage);
    },
  };
  const cycle = () =>
    processKnowledgeConvergence({
      events: f.events,
      artifacts: f.artifacts,
      host,
      workerId: "canonical-integration-fixture",
      writableEventSchemaVersion: 4,
      maximumStages: 8,
    });
  let direct: Promise<KnowledgeConvergenceInput> | null = null;
  return {
    f,
    context,
    runtime,
    /** Calls `canonical_integration` directly; the obligation is opened by hand once. */
    integrate: async () =>
      integrateCanonicalBaseline(
        context,
        await (direct ??= openReviewedObligation(f, await readFile(targetPath, "utf8"))),
        () => {},
      ),
    cycle,
    /** Owner cycles until the obligation settles, waits, or needs attention or recovery. */
    converge: async () => {
      let status = await cycle();
      for (let index = 1; index < 6 && !SETTLED_STATES.includes(status.state); index++)
        status = await cycle();
      return status;
    },
    /**
     * Deletes the delegation, then runs one real worker turn, on the owner path unless `owner` says
     * otherwise. Without a delegation, convergence waits for authority before any provider call,
     * so the turn exercises retention and inspection only; retirement itself never reads the
     * delegation (ADR-0518).
     */
    runTurnWithoutDelegation: async (
      owner?: Parameters<typeof runAutonomousKnowledgeWorker>[0]["owner"],
    ) => {
      await rm(resolve(f.root, ".lervo/knowledge/convergence-delegation.json"), { force: true });
      return runAutonomousKnowledgeWorker({
        storage: f.storage,
        provider: "claude",
        workerId: "canonical-retention",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        ...(owner === undefined ? {} : { owner }),
      });
    },
  };
}

function settleReceipt(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  stage: KnowledgeConvergenceStage,
): Promise<KnowledgeConvergenceStageResult> {
  return completeConvergenceStage({
    sources: convergenceSourceObservation(context),
    artifacts: context.storage.artifacts,
    state,
    stage,
    nextStage: knowledgeConvergenceStages[knowledgeConvergenceStages.indexOf(stage) + 1] ?? null,
    stageData: {},
    proof: { status: "outside_canonical_integration_fixture" },
  });
}

/** Settles lifecycle verification with the final snapshot the owner requires; see above. */
async function settleLifecycle(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
): Promise<KnowledgeConvergenceStageResult> {
  const result = await settleReceipt(context, state, "lifecycle_verification");
  return { ...result, knowledgeSnapshotHash: result.input.snapshotHash };
}

/** Opens an obligation by hand whose canonical batch was already reviewed and approved. */
async function openReviewedObligation(
  f: Awaited<ReturnType<typeof fixture>>,
  reviewed: string,
): Promise<KnowledgeConvergenceInput> {
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  baseline.assessmentPaths = [CANONICAL_SOURCE];
  const obligationId = stableId("kconv", { fixture: "canonical-integration", baseline });
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId,
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    stageData: {},
    receipts: [],
  };
  f.events.append({
    eventId: stableId("evt", [obligationId, "baseline"], 32),
    projectId: baseline.projectId,
    runId: `run_${sha256(obligationId).slice(7, 39)}`,
    sessionId: `ses_${sha256(`session:${obligationId}`).slice(7, 39)}`,
    actor: { kind: "system" },
    schemaVersion: 4,
    policyVersion: baseline.policyHash,
    type: "repository.knowledge.baseline.requested",
    occurredAt: new Date().toISOString(),
    payload: {
      obligationId,
      sourceSnapshotId: baseline.sourceSnapshotId,
      sourceSnapshotHash: baseline.sourceSnapshotHash,
      policyHash: baseline.policyHash,
      debtDigest: baseline.debtDigest,
      delegationHash: baseline.delegationHash,
      debtCounts: baseline.debtCounts,
      inputArtifactHash: (await f.artifacts.put(canonicalJson(state))).contentHash,
      requestedAt: new Date().toISOString(),
    },
  });
  const source = baseline.sources.find((item) => item.path === CANONICAL_SOURCE)!;
  const batch: CanonicalBatch = {
    offset: 0,
    count: 1,
    sources: [source],
    context: [],
    batchId: sha256(canonicalJson([obligationId, "canonical", 0, state.snapshotHash])),
    generatorAgentId: "agt_canonical_generator",
    assessment: {
      decisions: [
        {
          path: source.path,
          contentHash: source.contentHash,
          disposition: "candidate",
          rationale: "The observed runtime limit is a durable requirement for this repository.",
          canonicalReferences: [],
        },
      ],
      drafts: [
        reviewedRuntimeDraft({
          path: CANONICAL_TARGET,
          content: reviewed,
          contentHash: sha256(reviewed),
        }),
      ],
    },
  };
  state.stageData = {
    canonicalBatch: batch,
    canonicalApproval: {
      assessmentHash: sha256(canonicalJson(batch.assessment)),
      reviewerAgentId: "agt_independent_canonical_reviewer",
      delegationHash: baseline.delegationHash,
      policyHash: baseline.policyHash,
    },
  };
  return state;
}
