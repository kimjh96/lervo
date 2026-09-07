import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { RemoteCommandTarget, RemoteContinuationCoordinate } from "@lervo/schemas";
import { validateSchema, type WorkstreamReplicationReadResponse } from "@lervo/schemas";

export interface HubWorkstreamReadPort {
  readWorkstream(): Promise<unknown>;
}

export interface HubWorkstreamContinuationResolverOptions {
  target: RemoteCommandTarget;
  destinationId: string;
  expectedHubIdentityHash: string;
  assignmentId: string | null;
  agentId: string | null;
  transport: HubWorkstreamReadPort;
}

function workstreamContentHash(snapshot: WorkstreamReplicationReadResponse["snapshot"]): string {
  return `sha256:${createHash("sha256")
    .update(`${canonicalJson(snapshot)}\n`)
    .digest("hex")}`;
}

export class HubWorkstreamContinuationResolver {
  constructor(private readonly options: HubWorkstreamContinuationResolverOptions) {
    if (
      (options.assignmentId !== null && !/^asn_[a-f0-9]{24}$/u.test(options.assignmentId)) ||
      (options.agentId !== null && !/^agt_[a-f0-9]{24}$/u.test(options.agentId))
    ) {
      throw new Error("The Hub workstream continuation assignment binding is invalid.");
    }
  }

  async resolve(): Promise<RemoteContinuationCoordinate> {
    const response = await this.options.transport.readWorkstream();
    if (
      typeof response !== "object" ||
      response === null ||
      !("authentication" in response) ||
      !("body" in response) ||
      typeof response.authentication !== "object" ||
      response.authentication === null
    ) {
      throw new Error("The Hub workstream response is not authenticated.");
    }
    const authentication = response.authentication as Record<string, unknown>;
    if (
      authentication.status !== "verified" ||
      authentication.destinationId !== this.options.destinationId ||
      authentication.peerIdentityHash !== this.options.expectedHubIdentityHash
    ) {
      throw new Error("The Hub workstream response identity is unverified.");
    }
    const body = response.body;
    if (!validateSchema("workstreamReplicationReadResponse", body).valid) {
      throw new Error("The Hub workstream response is invalid.");
    }
    const current = body as WorkstreamReplicationReadResponse;
    if (
      current.status !== "current" ||
      current.projectId !== this.options.target.projectId ||
      current.repositoryIdentityHash !== this.options.target.projectIdentityHash ||
      current.snapshot === null ||
      current.snapshot.status !== "active" ||
      current.heads.length !== 1
    ) {
      throw new Error("The Hub does not have one active continuation workstream.");
    }
    const head = current.heads[0]!;
    if (
      head.workstreamId !== current.snapshot.workstreamId ||
      head.revision !== current.snapshot.revision ||
      head.status !== current.snapshot.status ||
      head.snapshotContentHash !== workstreamContentHash(current.snapshot)
    ) {
      throw new Error("The Hub workstream head differs from its snapshot.");
    }
    return {
      workstreamId: head.workstreamId,
      revision: head.revision,
      snapshotContentHash: head.snapshotContentHash,
      assignmentId: this.options.assignmentId,
      agentId: this.options.agentId,
    };
  }
}
