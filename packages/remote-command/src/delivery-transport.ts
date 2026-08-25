import {
  type RemoteCommandDeliveryAcknowledgement,
  type RemoteCommandTarget,
} from "@lervo/schemas";

export interface VerifiedRemoteCommandHubPeer {
  status: "verified";
  destinationId: string;
  peerIdentityHash: string;
}

export interface RemoteCommandHubTransportResponse {
  authentication: VerifiedRemoteCommandHubPeer;
  body: unknown;
}

/** TLS, signature, or equivalent peer authentication belongs behind this port. */
export interface AuthenticatedRemoteCommandHubTransport {
  pullRemoteCommands(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    nodeId: string;
    requestedAt: string;
    leaseDurationMs: number;
    limit: number;
  }): Promise<unknown>;

  acknowledgeRemoteCommand(acknowledgement: RemoteCommandDeliveryAcknowledgement): Promise<unknown>;
}

export function authenticatedRemoteCommandBody(input: {
  response: unknown;
  destinationId: string;
  expectedPeerIdentityHash: string;
}): unknown {
  if (
    typeof input.response !== "object" ||
    input.response === null ||
    !("authentication" in input.response) ||
    !("body" in input.response) ||
    typeof input.response.authentication !== "object" ||
    input.response.authentication === null
  ) {
    throw new RemoteCommandDeliveryError("transport_authentication_failed");
  }
  const authentication = input.response.authentication as Record<string, unknown>;
  if (
    authentication.status !== "verified" ||
    authentication.destinationId !== input.destinationId ||
    authentication.peerIdentityHash !== input.expectedPeerIdentityHash ||
    typeof authentication.peerIdentityHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(authentication.peerIdentityHash)
  ) {
    throw new RemoteCommandDeliveryError("transport_authentication_failed");
  }
  return input.response.body;
}

export type RemoteCommandDeliveryErrorCode =
  | "hub_unavailable"
  | "transport_authentication_failed"
  | "invalid_lease_response"
  | "invalid_delivery_confirmation";

export class RemoteCommandDeliveryError extends Error {
  constructor(readonly code: RemoteCommandDeliveryErrorCode) {
    super(code);
    this.name = "RemoteCommandDeliveryError";
  }
}
