import type { SearchRolloutQualitySnapshot, SearchRolloutReview } from "./rollout-review-types.js";
import type { SearchEngineIdentity } from "./types.js";

export interface SearchRolloutCurrentSelection {
  selectionTransitionId: string | null;
  selectionState: "implicit_baseline" | "recorded_baseline" | "candidate";
  candidateId: string | null;
  engine: SearchEngineIdentity;
  adapterBuildId: string | null;
  candidateReviewId: string | null;
  buildEvidenceState: "not_applicable" | "bound" | "legacy_unbound";
}

export interface SearchRolloutReviewStatusItem {
  review: SearchRolloutReview;
  currentQualitySnapshot: SearchRolloutQualitySnapshot;
  qualityInputState: "unchanged" | "changed";
  selectionRelation: "current_selection" | "historical_selection";
}

export interface SearchRolloutStatusPage {
  schemaVersion: 1;
  projectId: string;
  observedAt: string;
  currentSelection: SearchRolloutCurrentSelection;
  reviewCount: number;
  pageLimit: number;
  reviews: SearchRolloutReviewStatusItem[];
  nextCursor: string | null;
  reviewDecisionSelection: "not_performed";
  effect: {
    selectionChange: "not_applied";
    rollback: "not_executed";
    approval: "not_granted";
  };
}

export interface SearchRolloutStatusEvidence {
  review: SearchRolloutReview;
  currentQualitySnapshot: SearchRolloutQualitySnapshot;
}
