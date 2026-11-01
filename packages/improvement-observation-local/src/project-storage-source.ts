import { ImprovementObservationPortError } from "@lervo/application-contract";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";

import { createEventStoreImprovementEvidenceSource } from "./event-source.js";
import type {
  LocalImprovementEvidenceSnapshotV1,
  LocalImprovementEvidenceSourceV1,
} from "./types.js";

export interface ProjectStorageImprovementEvidenceSourceOptionsV1 {
  repositoryRoot: string;
  maximumEvidenceEvents?: number;
  openStorage?: (root: string) => Promise<ProjectStorage>;
}

async function readAndClose(
  storage: ProjectStorage,
  read: () => Promise<LocalImprovementEvidenceSnapshotV1>,
): Promise<LocalImprovementEvidenceSnapshotV1> {
  let result: LocalImprovementEvidenceSnapshotV1 | undefined;
  let readFailure: unknown;
  try {
    result = await read();
  } catch (error) {
    readFailure = error;
  }
  try {
    await storage.close();
  } catch (closeFailure) {
    throw new ImprovementObservationPortError(
      "evidence_unavailable",
      "The local project observation source could not be closed safely.",
      {
        cause:
          readFailure === undefined
            ? closeFailure
            : new AggregateError([readFailure, closeFailure]),
      },
    );
  }
  if (readFailure !== undefined) throw readFailure;
  return result!;
}

export function createProjectStorageImprovementEvidenceSource(
  input: ProjectStorageImprovementEvidenceSourceOptionsV1,
): LocalImprovementEvidenceSourceV1 {
  const openStorage = input.openStorage ?? openProjectStorage;
  return {
    readWindow: async (window) => {
      let storage: ProjectStorage;
      try {
        storage = await openStorage(input.repositoryRoot);
      } catch (error) {
        throw new ImprovementObservationPortError(
          "evidence_unavailable",
          "The local project observation source could not be opened.",
          { cause: error },
        );
      }
      const source = createEventStoreImprovementEvidenceSource({
        projectId: storage.manifest.projectId,
        events: storage.events,
        ...(input.maximumEvidenceEvents === undefined
          ? {}
          : { maximumEvidenceEvents: input.maximumEvidenceEvents }),
      });
      return readAndClose(storage, () => source.readWindow(window));
    },
  };
}
