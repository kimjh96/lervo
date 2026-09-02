import { AssignmentConnectorPortError } from "@lervo/application-contract";

import { slackAssignmentDigest } from "./assignment-digest.js";
import type { SlackAssignmentDestinationSourceV1 } from "./assignment-types.js";
import { assertSlackNativeDestination } from "./assignment-validation.js";

export function createConfiguredSlackAssignmentDestinationSource(input: {
  connectorId: string;
  destinations: readonly {
    destinationId: string;
    integrationId: string;
    status: "active" | "inactive";
    teamId: string;
    channelId: string;
    threadTs: string | null;
  }[];
}): SlackAssignmentDestinationSourceV1 {
  if (
    !input.connectorId.startsWith("con_") ||
    input.destinations.length === 0 ||
    input.destinations.length > 256 ||
    new Set(input.destinations.map((item) => item.destinationId)).size !== input.destinations.length
  ) {
    throw new AssignmentConnectorPortError(
      "request_invalid",
      "The Slack destination-source configuration is invalid.",
    );
  }
  for (const destination of input.destinations) assertSlackNativeDestination(destination);
  return {
    resolve: async ({ connectorId, destinationId }) => {
      const destination = input.destinations.find((item) => item.destinationId === destinationId);
      if (connectorId !== input.connectorId || destination === undefined) {
        throw new AssignmentConnectorPortError(
          "destination_not_found",
          "The Slack assignment destination is not configured.",
        );
      }
      const bindingHash = slackAssignmentDigest({
        schemaVersion: 1,
        connectorId,
        destinationId,
        integrationId: destination.integrationId,
        platform: "slack",
        teamId: destination.teamId,
        channelId: destination.channelId,
        threadTs: destination.threadTs,
      });
      return {
        public: {
          schemaVersion: 1,
          connectorId,
          destinationId,
          integrationId: destination.integrationId,
          bindingHash,
          status: destination.status,
        },
        teamId: destination.teamId,
        channelId: destination.channelId,
        threadTs: destination.threadTs,
      };
    },
  };
}
