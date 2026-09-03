import { describe, expect, it } from "vitest";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
  managedCanaryV15CheckpointContractPath,
  reviewedManagedCanaryV15CheckpointContractDigest,
} from "../../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import { createExactManagedCanaryV5Authorization } from "../../natural-language-evaluation/linked-evidence-managed-canary-v5-execution.mjs";
import { reviewedProviderShadowV18ScheduleFixture } from "./linked-evidence-managed-canary-source-fixture.mjs";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;

describe("managed linked-evidence canary v15 checkpoint", () => {
  it("binds the claim-eligibility boundary and unchanged cross-provider gates", async () => {
    const loaded = await loadManagedCanaryCheckpointContract(
      repositoryRoot,
      managedCanaryV15CheckpointContractPath,
    );
    const schedule = createManagedCanaryCheckpointSchedule(
      loaded.contract,
      reviewedProviderShadowV18ScheduleFixture,
    );

    expect(loaded.contractDigest).toBe(reviewedManagedCanaryV15CheckpointContractDigest);
    expect(schedule).toHaveLength(16);
    expect(schedule.filter((item) => item.provider === "codex")).toHaveLength(8);
    expect(schedule.filter((item) => item.provider === "claude")).toHaveLength(8);
    expect(loaded.contract.acceptance).toMatchObject({
      requiredSourceRecall: 1,
      minimumPerRunReferencePrecision: 0.5,
      minimumMeanReferencePrecisionPerProvider: 0.65,
    });
    expect(loaded.contract.runtime.referenceEligibilityContract).toEqual({
      id: "managed-context-reference-eligibility-v1",
      field: "referenceEligible",
      directTaskEvidence: true,
      explicitLinkOnlyTaskEvidence: false,
      directProvenanceWins: true,
      governanceContext: false,
      eligibleTaskEvidenceToken: "exact_lervo_e4_document_id_content_hash",
      ineligibleEvidenceToken: null,
      receiptEligibilityMatchRequired: true,
      fabricatedIneligibleTokenProducesE4: false,
    });
    expect(loaded.contract.measurementPredecessor).toMatchObject({
      preparedManifestDigest:
        "sha256:d743509f0645116cb04645b3548fa01c10884c0631e9955cb89c98423b501ebe",
      observationSetDigest:
        "sha256:3352f205dcf8051791430e69a707e8e00c0b379fce05ca93eb306efe79fdacd7",
      activationRejected: true,
      immutable: true,
      rescore: false,
    });
  });

  it("creates only exact sequential native-session authority", () => {
    expect(
      createExactManagedCanaryV5Authorization({
        checkpointId: "linked-evidence-managed-canary-v15-claim-eligibility-20260830",
        manifestDigest: `sha256:${"a".repeat(64)}`,
        authorizedAt: "2026-08-29T16:10:00.000Z",
      }),
    ).toMatchObject({
      providers: { codex: 8, claude: 8 },
      maximumSelectionCalls: 0,
      maximumTaskCalls: 16,
      maximumProviderCalls: 16,
      userApiKeysRequired: false,
      nativeSignedInSessionsRequired: true,
      retriesAuthorized: false,
      repairsAuthorized: false,
      replacementsAuthorized: false,
      writesAuthorized: false,
      productionActivationAuthorized: false,
    });
  });
});
