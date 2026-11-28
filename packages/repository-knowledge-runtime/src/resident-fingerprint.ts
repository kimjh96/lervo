import type { OutboxStore } from "@lervo/storage-contract";
import { withProcessCostScope } from "@lervo/repository-knowledge";

import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
import { convergenceEvaluationContract } from "./evaluation-contract.js";
import {
  evaluationFingerprint,
  hubTokenFingerprint,
  ownershipFingerprint,
} from "./resident-ownership.js";
import {
  convergenceSourceFingerprint,
  type ConvergenceSourceFingerprint,
} from "./source-fingerprint.js";

/**
 * The resident's whole change fence: the repository observation (ADR-0461), folded with the Hub's
 * change token (ADR-0602), this host's ownership role (ADR-0466) and the evaluation contract
 * (ADR-0485). A non-owner observes the lighter digest (ADR-0599).
 */
export function residentFingerprint(input: {
  repositoryRoot: string;
  events: OutboxStore;
  wakeOffsetMilliseconds: number;
  owner: ConvergenceOwnerVerdict | null;
  hubToken: string | null;
}): ConvergenceSourceFingerprint {
  return withProcessCostScope("fingerprint", () =>
    evaluationFingerprint(
      ownershipFingerprint(
        hubTokenFingerprint(
          convergenceSourceFingerprint({
            repositoryRoot: input.repositoryRoot,
            events: input.events,
            wakeOffsetMilliseconds: input.wakeOffsetMilliseconds,
            owner: input.owner === null || input.owner.role === "owner",
          }),
          input.hubToken,
        ),
        input.owner,
      ),
      convergenceEvaluationContract(),
    ),
  );
}
