export interface SupervisionDecisionReceipt {
  decisionId: string;
  planHash: string;
  status: "recorded" | "effect_confirmed" | "uncertain" | "superseded";
  effectEventIds: string[];
}
