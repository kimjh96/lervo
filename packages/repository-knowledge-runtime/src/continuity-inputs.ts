import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

import { readConvergenceOwnerFence } from "./convergence-owner-fence.js";
import { CONVERGENCE_OWNER_HOST_PATH } from "./convergence-owner-host.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { readKnowledgePublicationState } from "./knowledge-publication-state.js";
import { readKnowledgeProviderPauseStates } from "./provider-admission-inspection.js";
import { readProviderCliProjection } from "./provider-cli-projection.js";
import { repositoryHeadIdentity } from "./repository-head-identity.js";
import { inspectKnowledgeResidentHealth } from "./resident-health.js";
import { modelSelectionPath } from "@lervo/execution-contract";
import { hostModelSelectionDirectory } from "./model-selection-host.js";

async function contentHash(path: string | null): Promise<string | null> {
  if (path === null) return null;
  try {
    return sha256(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function settled<T>(work: () => Promise<T> | T): Promise<T | "unreadable"> {
  try {
    return Promise.resolve(work()).catch(() => "unreadable" as const);
  } catch {
    return Promise.resolve("unreadable" as const);
  }
}

/**
 * ADR-0602: a digest of every host-local input a continuity reconciliation reads, by the facts it
 * acts on rather than by observation times: the owner-host coordinates, the host policy, the
 * delegation and the history that decides who writes it, this host's verdict, publication and
 * resident state, provider pauses and CLI admission, and the Hub candidates. A reconciliation is
 * due when it differs from the one the last reconciliation recorded; Hub inputs arrive through
 * the Hub's `knowledge` change token instead, and time-based ones as continuity's own deadline.
 */
export async function continuityInputFingerprint(input: {
  root: string;
  policyPath: string | null;
  hubCandidates: unknown;
  now: Date;
}): Promise<string> {
  const { root } = input;
  const [
    ownerHost,
    policy,
    delegation,
    head,
    fence,
    publication,
    resident,
    pauses,
    provider,
    modelSelection,
    project,
  ] = await Promise.all([
    contentHash(resolve(root, CONVERGENCE_OWNER_HOST_PATH)),
    contentHash(input.policyPath),
    settled(async () => (await loadConvergenceDelegation(root))?.contentHash ?? null),
    settled(() => repositoryHeadIdentity(root)),
    settled(async () => {
      const verdict = (await readConvergenceOwnerFence(root))?.verdict ?? null;
      return verdict === null
        ? null
        : {
            role: verdict.role,
            holder: verdict.holder?.hostHash ?? null,
            generation: verdict.holder?.generation ?? null,
            failureCode: verdict.failureCode ?? null,
          };
    }),
    settled(async () => (await readKnowledgePublicationState(root))?.status ?? null),
    settled(async () => {
      const health = await inspectKnowledgeResidentHealth(root, input.now);
      return { status: health.status, state: health.state, reason: health.reason };
    }),
    settled(async () =>
      (await readKnowledgeProviderPauseStates({ now: input.now })).map((state) => ({
        provider: state.provider,
        paused: state.paused,
        reason: state.reason,
        observationHash: state.observationHash,
        resetAt: state.resetAt,
        nextReprobeAt: state.nextReprobeAt,
      })),
    ),
    settled(async () => {
      const projection = await readProviderCliProjection(root);
      if (projection === null) return null;
      const { observedAt: _observedAt, ...facts } = projection;
      return facts;
    }),
    // ADR-0612 M3: a changed model selection is republished in this host's record.
    settled(() => contentHash(modelSelectionPath(hostModelSelectionDirectory()))),
    // ADR-0656: a changed data policy re-derives the owner host without waiting for a commit.
    contentHash(resolve(root, ".lervo/project.yaml")),
  ]);
  return sha256(
    canonicalJson({
      ownerHost,
      policy,
      delegation,
      head,
      fence,
      publication,
      resident,
      pauses,
      provider,
      modelSelection,
      project,
      hubCandidates: input.hubCandidates,
    }),
  );
}
