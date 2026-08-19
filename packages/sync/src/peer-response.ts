import { RetryableSyncFailure } from "./retry-failure.js";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export function authenticatedResponseBody(input: {
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
    throw new RetryableSyncFailure("transport_authentication_failed");
  }
  const authentication = input.response.authentication as Record<string, unknown>;
  if (
    authentication.status !== "verified" ||
    authentication.destinationId !== input.destinationId ||
    authentication.peerIdentityHash !== input.expectedPeerIdentityHash ||
    !SHA256_PATTERN.test(authentication.peerIdentityHash)
  ) {
    throw new RetryableSyncFailure("transport_authentication_failed");
  }
  return input.response.body;
}
