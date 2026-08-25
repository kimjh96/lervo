import { type ProjectRegistrationResponse } from "@lervo/schemas";
import {
  assertProjectRegistrationResponse,
  createProjectRegistrationRequest,
} from "@lervo/sync-contract";

import { SyncWorkerError } from "./errors.js";
import { authenticatedResponseBody } from "./peer-response.js";
import { RetryableSyncFailure } from "./retry-failure.js";
import { type OutboundSyncWorkerOptions } from "./types.js";

export async function registerProject(input: {
  options: OutboundSyncWorkerOptions;
  requestedAt: string;
}) {
  let request;
  try {
    request = createProjectRegistrationRequest({
      manifest: input.options.manifest,
      destinationId: input.options.destinationId,
      requestedAt: input.requestedAt,
    });
  } catch (error) {
    throw new SyncWorkerError(
      "invalid_worker_configuration",
      "A Hub registration cannot be created from the project manifest.",
      { cause: error },
    );
  }

  let transportResponse: unknown;
  try {
    transportResponse = await input.options.transport.registerProject(request);
  } catch {
    throw new RetryableSyncFailure("hub_unavailable");
  }
  const body = authenticatedResponseBody({
    response: transportResponse,
    destinationId: input.options.destinationId,
    expectedPeerIdentityHash: input.options.expectedPeerIdentityHash,
  });
  try {
    const response = body as ProjectRegistrationResponse;
    assertProjectRegistrationResponse({ request, response });
    return { request, response };
  } catch {
    throw new RetryableSyncFailure("invalid_registration_response");
  }
}
