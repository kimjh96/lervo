/** An exact accepted goal and prepared publication; queueing never means transport success. */
export interface SupervisedResultDeliveryV1 {
  schemaVersion: 1;
  kind: "work.result_delivery";
  workstreamId: string;
  ownerAgentId: string;
  completionPlanHash: string;
  completionEventId: string;
  resultArtifactHash: string;
  candidateArtifactHash: string;
  outboundArtifactHash: string;
  rationaleArtifactHash: string;
}

/** Native publication carries the independent semantic judgement's exact managed lineage. */
export interface SupervisedResultDeliveryV2 extends Omit<
  SupervisedResultDeliveryV1,
  "schemaVersion"
> {
  schemaVersion: 2;
  reasoningPlanHash: string;
  reasoningResultHash: string;
}
export type SupervisedResultDelivery = SupervisedResultDeliveryV1 | SupervisedResultDeliveryV2;
