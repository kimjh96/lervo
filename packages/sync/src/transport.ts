import {
  type OutboundEventBatch,
  type ProjectRegistrationRequest,
} from "@lervo/schemas";

export interface VerifiedHubPeer {
  status: "verified";
  destinationId: string;
  peerIdentityHash: string;
}

/**
 * The transport implementation creates this proof after its own TLS, signature,
 * or equivalent peer authentication. The worker still checks its configured
 * destination and peer identity before it trusts the response body.
 */
export interface HubTransportResponse {
  authentication: VerifiedHubPeer;
  body: unknown;
}

export interface AuthenticatedHubTransport {
  registerProject(request: ProjectRegistrationRequest): Promise<unknown>;
  sendEventBatch(batch: OutboundEventBatch): Promise<unknown>;
}
