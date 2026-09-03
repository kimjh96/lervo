import type {
  ImprovementObservationCollectorV1,
  ImprovementObservationPortV1,
} from "@lervo/application-contract";
import {
  LOCAL_IMPROVEMENT_OBSERVATION_ADAPTER_ID,
  createProjectStorageImprovementObservationAdapter,
} from "@lervo/improvement-observation-local";

export interface LocalImprovementObservationHostV1 {
  adapterId: string;
  collector: ImprovementObservationCollectorV1;
  verifier: ImprovementObservationPortV1;
}

export type CreateLocalImprovementObservationHost = (input: {
  repositoryRoot: string;
}) => LocalImprovementObservationHostV1 | Promise<LocalImprovementObservationHostV1>;

export const createLocalImprovementObservationHost: CreateLocalImprovementObservationHost = ({
  repositoryRoot,
}) => {
  const adapter = createProjectStorageImprovementObservationAdapter({ repositoryRoot });
  return {
    adapterId: LOCAL_IMPROVEMENT_OBSERVATION_ADAPTER_ID,
    collector: adapter,
    verifier: adapter,
  };
};
