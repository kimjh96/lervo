import { AssignmentConnectorPortError } from "@lervo/application-contract";
import type { WritingPublicationPermit } from "@lervo/schemas";

import type { SlackAssignmentPermitSourceV1 } from "./assignment-types.js";

export function createConfiguredSlackAssignmentPermitSource(input: {
  permits: readonly WritingPublicationPermit[];
}): SlackAssignmentPermitSourceV1 {
  if (
    input.permits.length === 0 ||
    input.permits.length > 1_024 ||
    new Set(input.permits.map((item) => item.permitId)).size !== input.permits.length
  ) {
    throw new AssignmentConnectorPortError(
      "request_invalid",
      "The Slack permit-source configuration is invalid.",
    );
  }
  return {
    read: async ({ permitId }) => {
      const permit = input.permits.find((item) => item.permitId === permitId);
      if (permit === undefined) {
        throw new AssignmentConnectorPortError(
          "permit_invalid",
          "The Slack publication permit is not configured.",
        );
      }
      return structuredClone(permit);
    },
  };
}
