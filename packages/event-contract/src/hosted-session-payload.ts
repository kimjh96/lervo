/** ADR-0613: every hosted session payload field; sessions appear only as digests. */
export const hostedSessionPayloadAllowlists = {
  "application.workspace.started": [
    "workspaceId",
    "workstreamId",
    "branch",
    "providerSessionDigest",
    "instructionDigest",
    "startedAt",
  ],
  "terminal.session.launch_prepared": [
    "providerSessionDigest",
    "provider",
    "workspaceId",
    "conversationMode",
    "descriptorDigest",
  ],
  "terminal.session.launched": ["providerSessionDigest", "provider", "descriptorDigest"],
  "terminal.session.ended": ["providerSessionDigest", "endReason", "exitCode"],
} as const;
export const hostedSessionPayloadSchemas = {
  "application.workspace.started": "applicationWorkspaceStartedEventPayload",
  "terminal.session.launch_prepared": "terminalSessionLaunchPreparedEventPayload",
  "terminal.session.launched": "terminalSessionLaunchedEventPayload",
  "terminal.session.ended": "terminalSessionEndedEventPayload",
} as const;
