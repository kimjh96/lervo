import { AssignmentConnectorPortError } from "@lervo/application-contract";

import type { SlackAssignmentCredentialSourceV1 } from "./assignment-types.js";
import { assertSlackNativeDestination } from "./assignment-validation.js";

export function createEnvironmentSlackAssignmentCredentialSource(input: {
  integrationId: string;
  credentialId: string;
  teamId: string;
  tokenEnvironmentVariable: string;
  environment?: Readonly<Record<string, string | undefined>>;
}): SlackAssignmentCredentialSourceV1 {
  if (
    !input.integrationId.startsWith("int_") ||
    !input.credentialId.startsWith("cred_") ||
    !/^[A-Z][A-Z0-9_]{0,127}$/u.test(input.tokenEnvironmentVariable)
  ) {
    throw new AssignmentConnectorPortError(
      "request_invalid",
      "The Slack credential-source configuration is invalid.",
    );
  }
  return {
    resolve: async ({ integrationId }) => {
      if (integrationId !== input.integrationId) return { status: "unavailable" };
      const token = (input.environment ?? process.env)[input.tokenEnvironmentVariable];
      if (token === undefined) return { status: "unavailable" };
      if (token.length < 20 || token.length > 4_096 || !/^[\x21-\x7e]+$/u.test(token)) {
        throw new AssignmentConnectorPortError(
          "credential_unavailable",
          "The Slack credential does not satisfy the bounded bot-token contract.",
        );
      }
      assertSlackNativeDestination({ teamId: input.teamId, channelId: "C00", threadTs: null });
      return {
        status: "available",
        credentialId: input.credentialId,
        botToken: token,
        teamId: input.teamId,
      };
    },
  };
}
