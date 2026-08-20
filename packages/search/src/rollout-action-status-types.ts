import type { SearchEngineRolloutRollback } from "./engine-activation-types.js";
import type { SearchRolloutKeepAcknowledgement } from "./rollout-action-types.js";
import type { SearchRolloutQualitySnapshot, SearchRolloutReview } from "./rollout-review-types.js";
import type { SearchRolloutCurrentSelection } from "./rollout-status-types.js";

export type SearchRolloutActionStatusRecord =
  | SearchRolloutKeepAcknowledgement
  | SearchEngineRolloutRollback;

export interface SearchRolloutActionStatusEvidence {
  record: SearchRolloutActionStatusRecord;
  review: SearchRolloutReview;
  currentQualitySnapshot: SearchRolloutQualitySnapshot;
}

export interface SearchRolloutActionStatusItem extends SearchRolloutActionStatusEvidence {
  actionId: string;
  action: "acknowledge_keep" | "execute_rollback";
  actedAt: string;
  qualityInputState: "unchanged" | "changed";
  reviewSelectionRelation: "current_selection" | "historical_selection";
  actionTransitionRelation: "not_applicable" | "current_selection" | "historical_selection";
}

export interface SearchRolloutActionStatusPage {
  schemaVersion: 1;
  projectId: string;
  observedAt: string;
  currentSelection: SearchRolloutCurrentSelection;
  actionCount: number;
  pageLimit: number;
  actions: SearchRolloutActionStatusItem[];
  nextCursor: string | null;
  actionSelection: "not_performed";
  effect: {
    selectionChange: "not_applied";
    rollback: "not_executed";
    approval: "not_granted";
  };
}
