import type { OperatingAttentionReportV1 } from "@lervo/application-contract";
import { openProjectStorage, openReadOnlyProjectStorage } from "@lervo/project-storage";
import {
  defaultWorkstreamFreshnessPolicy,
  listCanonicalizationCandidates,
  loadRepositoryKnowledgePolicy,
  workstreamFreshnessPolicy,
} from "@lervo/repository-knowledge";

import { readDocumentFreshnessAttention } from "./document-freshness-attention.js";
import { readHeldEffectsWithRepositoryHold } from "./held-effect-debt.js";
import { readStaleGitIndexLock } from "./git-index-lock-attention.js";
import { readInstructionCaptureAttention } from "./instruction-capture-attention.js";
import { readKnowledgeConvergenceAttention } from "./knowledge-convergence-attention.js";
import { createOperatingAttentionReport } from "./operating-attention-projection.js";
import { readRepositoryReplicaDivergence } from "./repository-replica-divergence-source.js";
import { inspectTerminalLifecycle } from "./terminal-lifecycle-inspection.js";
import { observeWorkstreamFreshness } from "./workstream-repository-head.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";
import { readHealthWorkstream } from "./repository-health-workstream.js";
import { captureTerminalRepositorySnapshot } from "./terminal-repository-snapshot.js";
import { readTerminalKnowledgeLifecycleCacheEntry } from "./terminal-knowledge-lifecycle-cache.js";
import { readRepositoryHealth } from "./repository-health-reader.js";
import { readCasRetentionAttention } from "./cas-retention-attention.js";
import { readWakeChannelAttention } from "./wake-channel-attention.js";

export interface InspectOperatingAttentionInput {
  repositoryRoot: string;
  /**
   * The checkout whose workstream and files count; a linked worktree passes its own root while
   * `repositoryRoot` is its registered repository (ADR-0633). Defaults to `repositoryRoot`.
   */
  checkoutRoot?: string;
  observedAt?: Date;
  /** Background projection reads only existing lifecycle evidence; it never runs lint. */
  cachedSourcesOnly?: boolean;
}

export type InspectOperatingAttention = (
  input: InspectOperatingAttentionInput,
) => Promise<OperatingAttentionReportV1>;

export const inspectOperatingAttention: InspectOperatingAttention = async (input) => {
  const storage = await (input.cachedSourcesOnly ? openReadOnlyProjectStorage : openProjectStorage)(
    input.repositoryRoot,
  );
  try {
    const checkoutRoot = input.checkoutRoot ?? input.repositoryRoot;
    const observedAt = input.observedAt ?? new Date();
    const snapshot = await captureTerminalRepositorySnapshot(input.repositoryRoot);
    const [
      workstreamObservation,
      canonicalization,
      lifecycle,
      replica,
      documentFreshness,
      instructionCapture,
      convergence,
      heldEffects,
      wakeChannel,
      casRetention,
      gitIndexLock,
    ] = await Promise.all([
      input.cachedSourcesOnly
        ? readHealthWorkstream(storage)
        : verifiedCurrentWorkstream(storage, checkoutRoot).then((snapshot) => ({
            snapshot,
            coverage: snapshot === null ? ("missing" as const) : ("current" as const),
          })),
      listCanonicalizationCandidates(input.repositoryRoot).then(
        (candidates) => ({ coverage: "complete" as const, candidates }),
        () => ({ coverage: "unavailable" as const, candidates: [] }),
      ),
      (input.cachedSourcesOnly
        ? readTerminalKnowledgeLifecycleCacheEntry({
            root: input.repositoryRoot,
            repositoryRevision: snapshot.revision,
            supplementalSources: [],
          }).then((cached) => {
            if (cached === null) throw new Error("Lifecycle cache unavailable.");
            return { issues: cached.issues, knowledgeAdvisories: cached.advisories };
          })
        : inspectTerminalLifecycle(input.repositoryRoot, undefined, undefined, checkoutRoot)
      ).then(
        (inspection) => ({
          coverage: input.cachedSourcesOnly ? ("cached" as const) : ("complete" as const),
          issues: [
            ...inspection.issues,
            ...(inspection.knowledgeAdvisories ?? []),
            ...("serviceAdvisories" in inspection ? (inspection.serviceAdvisories ?? []) : []),
          ],
        }),
        () => ({ coverage: "unavailable" as const, issues: [] }),
      ),
      readRepositoryReplicaDivergence(input.repositoryRoot),
      readDocumentFreshnessAttention(input.repositoryRoot, observedAt),
      readInstructionCaptureAttention(input.repositoryRoot),
      readKnowledgeConvergenceAttention(input.repositoryRoot, storage.manifest.projectId).catch(
        () => null,
      ),
      readHeldEffectsWithRepositoryHold(input.repositoryRoot),
      readWakeChannelAttention(input.repositoryRoot, storage.events),
      readCasRetentionAttention(input.repositoryRoot, observedAt),
      readStaleGitIndexLock(input.repositoryRoot),
    ]);
    const workstream = workstreamObservation.snapshot;
    const workstreamFreshness =
      workstream === null
        ? null
        : await observeWorkstreamFreshness({
            root: checkoutRoot,
            snapshot: workstream,
            policy: await loadRepositoryKnowledgePolicy(input.repositoryRoot).then(
              workstreamFreshnessPolicy,
              () => defaultWorkstreamFreshnessPolicy,
            ),
            observedAt,
          });
    const health = input.cachedSourcesOnly
      ? undefined
      : await readRepositoryHealth({
          root: input.repositoryRoot,
          repositoryRevision: snapshot.revision,
          now: observedAt,
        });
    return createOperatingAttentionReport({
      projectId: storage.manifest.projectId,
      workstream,
      workstreamCoverage: workstreamObservation.coverage,
      workstreamFreshness,
      canonicalization,
      // ADR-0602: a service that cannot be woken by a change is attention, never silent.
      knowledgeLifecycle:
        lifecycle.coverage === "unavailable"
          ? lifecycle
          : {
              ...lifecycle,
              issues: [
                ...lifecycle.issues,
                ...(replica.status === "invalid" ? [replica.issue] : []),
                ...wakeChannel,
                // ADR-0658: a retention pass that cannot finish lets the CAS grow without bound.
                ...casRetention,
              ],
            },
      repositoryReplicaDivergence: replica.status === "observed" ? replica.divergence : null,
      documentFreshness,
      instructionCapture,
      knowledgeConvergence: convergence,
      heldEffects,
      staleGitIndexLock: gitIndexLock,
      observedAt,
      ...(health === undefined ? {} : { health }),
    });
  } finally {
    await storage.close();
  }
};
