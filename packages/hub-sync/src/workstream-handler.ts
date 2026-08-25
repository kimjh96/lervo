import {
  validateSchema,
  type WorkstreamReplicationPublishRequest,
  type WorkstreamReplicationPublishResponse,
  type WorkstreamReplicationReadResponse,
} from "@lervo/schemas";

import type { HubWorkstreamReplicationStore } from "./store.js";

export class HubWorkstreamReplicationError extends Error {
  constructor(
    readonly code:
      | "invalid_workstream"
      | "registration_required"
      | "unknown_parent"
      | "head_limit_exceeded"
      | "workstream_conflict",
    message: string,
  ) {
    super(message);
    this.name = "HubWorkstreamReplicationError";
  }
}

export async function handleWorkstreamPublish(input: {
  store: HubWorkstreamReplicationStore;
  destinationId: string;
  request: WorkstreamReplicationPublishRequest;
  publishedAt: string;
}): Promise<WorkstreamReplicationPublishResponse> {
  if (
    !validateSchema("workstreamReplicationPublishRequest", input.request).valid ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(input.publishedAt) ||
    !Number.isFinite(Date.parse(input.publishedAt))
  ) {
    throw new HubWorkstreamReplicationError(
      "invalid_workstream",
      "The workstream replication request is invalid.",
    );
  }
  return input.store.publishWorkstream({
    destinationId: input.destinationId,
    request: structuredClone(input.request),
    publishedAt: input.publishedAt,
  });
}

export async function handleWorkstreamRead(input: {
  store: HubWorkstreamReplicationStore;
  destinationId: string;
  projectId: string;
  repositoryIdentityHash: string;
}): Promise<WorkstreamReplicationReadResponse> {
  return input.store.readWorkstream({
    destinationId: input.destinationId,
    projectId: input.projectId,
    repositoryIdentityHash: input.repositoryIdentityHash,
  });
}
