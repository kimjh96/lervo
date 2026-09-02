import { AssignmentConnectorPortError } from "@lervo/application-contract";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { SlackAssignmentArtifactSourceV1 } from "./assignment-types.js";

export function createArtifactStoreSlackAssignmentSource(input: {
  artifactStore: ArtifactStore;
  coordinates: readonly { artifactId: string; uri: string }[];
}): SlackAssignmentArtifactSourceV1 {
  if (
    input.coordinates.length === 0 ||
    input.coordinates.length > 1_024 ||
    new Set(input.coordinates.map((item) => item.artifactId)).size !== input.coordinates.length
  ) {
    throw new AssignmentConnectorPortError(
      "request_invalid",
      "The Slack artifact-source configuration is invalid.",
    );
  }
  return {
    read: async ({ artifactId }) => {
      const coordinate = input.coordinates.find((item) => item.artifactId === artifactId);
      if (coordinate === undefined) {
        throw new AssignmentConnectorPortError(
          "artifact_invalid",
          "The Slack assignment artifact is not configured.",
        );
      }
      try {
        return await input.artifactStore.get(coordinate.uri);
      } catch (error) {
        throw new AssignmentConnectorPortError(
          "artifact_invalid",
          "The Slack assignment artifact could not be read.",
          { cause: error },
        );
      }
    },
  };
}
