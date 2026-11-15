import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonicalJson,
  sha256,
  stableId,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { integrateCanonicalBaseline } from "../src/canonical-integration-stage.js";
import type { CanonicalBatch } from "../src/canonical-review.js";
import { assertConvergenceSourceCurrent, assertConvergenceSourceExact } from "../src/host.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";
import { fixture } from "./fixture.js";

export const CANONICAL_SOURCE = "src/runtime.ts";
export const CANONICAL_TARGET = "docs/specs/runtime.md";
export const INTEGRATED_REQUIREMENT = "Background model calls are limited to two per host.";

const RATIONALE = "The observed runtime limit is a durable requirement for this repository.";
const REVIEWER_AGENT_ID = "agt_independent_canonical_reviewer";

/**
 * Reaches `canonical_integration` directly: a real repository, delegation and integration ref, an
 * opened obligation and a reviewed draft of the runtime specification. Assessment, review and the
 * provider never run, so a case pays only for the stage it observes.
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
  const reviewed = await readFile(targetPath, "utf8");
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
  const baselineEvent = {
    runId: `run_${sha256(obligationId).slice(7, 39)}`,
    sessionId: `ses_${sha256(`session:${obligationId}`).slice(7, 39)}`,
  };
  const opened = f.events.append({
    eventId: stableId("evt", [obligationId, "baseline"], 32),
    projectId: baseline.projectId,
    ...baselineEvent,
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
          rationale: RATIONALE,
          canonicalReferences: [],
        },
      ],
      drafts: [
        {
          path: CANONICAL_TARGET,
          beforeHash: sha256(reviewed),
          content: `${reviewed}\n${INTEGRATED_REQUIREMENT}\n`,
        },
      ],
    },
  };
  state.stageData = {
    canonicalBatch: batch,
    canonicalApproval: {
      assessmentHash: sha256(canonicalJson(batch.assessment)),
      reviewerAgentId: REVIEWER_AGENT_ID,
      delegationHash: baseline.delegationHash,
      policyHash: baseline.policyHash,
    },
  };
  // The runtime host's own exact and current fences guard every effect, as in a worker turn.
  const context: ConvergenceRuntimeContext = {
    storage: f.storage,
    provider: "claude",
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSourceExact: (input) => assertConvergenceSourceExact(context, input),
    assertSourceCurrent: (input) => assertConvergenceSourceCurrent(context, input),
  };
  return {
    f,
    state,
    batch,
    context,
    integrate: () => integrateCanonicalBaseline(context, state, () => {}),
    /** Records the terminal outcome that ADR-0518 retention waits for before retiring checkouts. */
    settleObligation: () =>
      f.events.append({
        eventId: stableId("evt", [obligationId, "terminal"], 32),
        projectId: baseline.projectId,
        ...baselineEvent,
        actor: { kind: "system" },
        schemaVersion: 4,
        policyVersion: baseline.policyHash,
        type: "repository.knowledge.convergence.recorded",
        occurredAt: new Date().toISOString(),
        payload: {
          obligationId,
          originalEventId: opened.event.eventId,
          originalEventHash: opened.event.eventHash,
          scope: "baseline",
          terminalState: "superseded",
          snapshotHash: state.snapshotHash,
          canonicalDispositionDigest: sha256("superseded"),
          normalizationCoverageDigest: sha256("superseded"),
          lifecycleReceiptDigest: sha256("superseded"),
          knowledgeSnapshotHash: null,
          successorId: stableId("kconv", { fixture: "successor", obligationId }),
          failureCode: "source_bytes_changed",
          resolvedAt: new Date().toISOString(),
        },
      }),
    /**
     * One real worker turn, on the owner path unless `owner` says otherwise. Without a delegation,
     * convergence waits for authority before any provider call, so the turn exercises retention
     * and inspection only; retirement itself never reads the delegation (ADR-0518).
     */
    runRetentionTurn: async (
      owner?: Parameters<typeof runAutonomousKnowledgeWorker>[0]["owner"],
    ) => {
      await rm(resolve(f.root, ".lervo/knowledge/convergence-delegation.json"));
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
