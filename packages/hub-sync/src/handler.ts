import {
  type EventSyncAcknowledgement,
  type OutboundEventBatch,
  type ProjectRegistrationRequest,
  type ProjectRegistrationResponse,
} from "@lervo/schemas";
import {
  assertOutboundEventBatch,
  assertProjectRegistrationRequest,
  planOutboundEventAcceptance,
  planProjectRegistration,
  SyncContractError,
} from "@lervo/sync-contract";

import { type HubProjectCoordinate, type HubSyncStore } from "./store.js";

function registrationCoordinate(request: ProjectRegistrationRequest): HubProjectCoordinate {
  return {
    destinationId: request.destinationId,
    projectId: request.project.projectId,
  };
}

function batchCoordinate(batch: OutboundEventBatch): HubProjectCoordinate {
  return {
    destinationId: batch.destinationId,
    projectId: batch.projectId,
  };
}

export function handleProjectRegistration(input: {
  store: HubSyncStore;
  request: ProjectRegistrationRequest;
  acceptedAt: string;
}): ProjectRegistrationResponse {
  assertProjectRegistrationRequest(input.request);
  return input.store.transact((transaction) => {
    const planned = planProjectRegistration({
      current: transaction.loadProject(registrationCoordinate(input.request)),
      request: input.request,
      acceptedAt: input.acceptedAt,
    });
    transaction.saveProject(planned.state);
    return planned.response;
  });
}

export function handleOutboundEventBatch(input: {
  store: HubSyncStore;
  batch: OutboundEventBatch;
  acknowledgedAt: string;
}): EventSyncAcknowledgement {
  assertOutboundEventBatch(input.batch);
  return input.store.transact((transaction) => {
    const state = transaction.loadProject(batchCoordinate(input.batch));
    if (state === null) {
      throw new SyncContractError(
        "registration_required",
        "outbound event batch와 일치하는 project registration이 없습니다.",
      );
    }
    const planned = planOutboundEventAcceptance({
      state,
      batch: input.batch,
      acknowledgedAt: input.acknowledgedAt,
    });
    transaction.saveProject(planned.state);
    return planned.acknowledgement;
  });
}
