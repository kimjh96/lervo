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
