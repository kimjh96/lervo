import type { ImprovementObservationWindowV1 } from "@lervo/application-contract";
import type { EventEnvelope } from "@lervo/schemas";

export interface LocalImprovementEvidenceSnapshotV1 {
  schemaVersion: 1;
  projectId: string;
  events: EventEnvelope[];
}

export interface LocalImprovementEvidenceSourceV1 {
  readWindow(window: ImprovementObservationWindowV1): Promise<LocalImprovementEvidenceSnapshotV1>;
}
