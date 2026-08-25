import {
  type EventSyncAcknowledgement,
  type OutboundEventBatch,
  type ProjectRegistrationRequest,
  type ProjectRegistrationResponse,
} from "@lervo/schemas";
import { assertOutboundEventBatch, assertProjectRegistrationRequest } from "@lervo/sync-contract";

import { type HubSyncCommandStore } from "./store.js";

export async function handleProjectRegistration(input: {
  store: HubSyncCommandStore;
  request: ProjectRegistrationRequest;
  acceptedAt: string;
}): Promise<ProjectRegistrationResponse> {
  assertProjectRegistrationRequest(input.request);
  return input.store.registerProject({
    request: structuredClone(input.request),
    acceptedAt: input.acceptedAt,
  });
}

export async function handleOutboundEventBatch(input: {
  store: HubSyncCommandStore;
  batch: OutboundEventBatch;
  acknowledgedAt: string;
}): Promise<EventSyncAcknowledgement> {
  assertOutboundEventBatch(input.batch);
  return input.store.acceptEventBatch({
    batch: structuredClone(input.batch),
    acknowledgedAt: input.acknowledgedAt,
  });
}
