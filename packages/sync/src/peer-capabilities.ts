import { readEventReaderCapabilities } from "@lervo/event-contract";
import type { EventReaderCapabilities } from "@lervo/schemas";

import { authenticatedResponseBody } from "./peer-response.js";
import type { AuthenticatedHubCapabilityTransport } from "./transport.js";

export interface VerifiedHubEventReaderCapabilities {
  peerIdentityHash: string;
  capabilities: EventReaderCapabilities;
}

export async function observeVerifiedHubEventReaderCapabilities(input: {
  transport: AuthenticatedHubCapabilityTransport;
  destinationId: string;
  expectedPeerIdentityHash: string;
}): Promise<VerifiedHubEventReaderCapabilities> {
  const response = await input.transport.readEventReaderCapabilities();
  const body = authenticatedResponseBody({
    response,
    destinationId: input.destinationId,
    expectedPeerIdentityHash: input.expectedPeerIdentityHash,
  });
  return {
    peerIdentityHash: input.expectedPeerIdentityHash,
    capabilities: readEventReaderCapabilities(body),
  };
}
