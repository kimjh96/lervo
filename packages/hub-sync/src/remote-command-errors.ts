export type HubRemoteCommandRequestErrorCode =
  | "invalid_remote_command_enqueue"
  | "invalid_remote_command_lease_request"
  | "invalid_remote_command_acknowledgement";

export class HubRemoteCommandRequestError extends Error {
  constructor(
    readonly code: HubRemoteCommandRequestErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HubRemoteCommandRequestError";
  }
}

export type HubRemoteCommandFailureKind =
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "internal";

export type HubRemoteCommandStoreErrorCode =
  | "remote_command_ack_invalid"
  | "remote_command_conflict"
  | "remote_command_identity_mismatch"
  | "remote_command_registration_required";

export class HubRemoteCommandStoreError extends Error {
  constructor(
    readonly code: HubRemoteCommandStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HubRemoteCommandStoreError";
  }
}

/**
 * Keeps transport adapters independent from a concrete queue store while
 * preserving the stable failures required by the queue port.
 */
export function classifyHubRemoteCommandFailure(error: unknown): HubRemoteCommandFailureKind {
  if (error instanceof HubRemoteCommandRequestError) return "invalid_request";
  if (!(error instanceof HubRemoteCommandStoreError)) return "internal";
  const code = error.code;
  if (code === "remote_command_registration_required") return "not_found";
  if (
    code === "remote_command_identity_mismatch" ||
    code === "remote_command_conflict" ||
    code === "remote_command_ack_invalid"
  ) return "conflict";
  return "internal";
}
