import {
  createLocalImprovementObservationAdapter,
  type LocalImprovementObservationAdapterV1,
} from "./adapter.js";
import {
  createProjectStorageImprovementEvidenceSource,
  type ProjectStorageImprovementEvidenceSourceOptionsV1,
} from "./project-storage-source.js";

export function createProjectStorageImprovementObservationAdapter(
  input: ProjectStorageImprovementEvidenceSourceOptionsV1 & { adapterId?: string },
): LocalImprovementObservationAdapterV1 {
  return createLocalImprovementObservationAdapter({
    ...(input.adapterId === undefined ? {} : { adapterId: input.adapterId }),
    evidenceSource: createProjectStorageImprovementEvidenceSource(input),
  });
}
