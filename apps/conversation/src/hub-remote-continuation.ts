import { createHash } from "node:crypto";

import type { ConversationRemoteContinuationPort } from "@lervo/conversation-control";
import {
  AuthenticatedRemoteCommandHttpSubmission,
  type RemoteCommandHttpSubmissionOptions,
} from "@lervo/remote-command";
import type {
  RemoteCommandTarget,
  RemoteContinuationCoordinate,
  SignedRemoteCommand,
} from "@lervo/schemas";
import { isRemoteContinuationCoordinate } from "@lervo/schemas";
import { AuthenticatedHubHttpTransport } from "@lervo/sync";

import { HubWorkstreamContinuationResolver } from "./hub-workstream-continuation.js";

export interface HubRemoteCommandSubmissionPort {
  submit(request: {
    idempotencyKey: string;
    lifetimeMs: number;
    roleId: string;
    provider: string;
    risk: "low" | "medium" | "high";
    verificationSuiteIds: string[];
    request: string;
    continuation: RemoteContinuationCoordinate;
  }): Promise<{
    status: "created" | "duplicate";
    destinationId: string;
    target: RemoteCommandTarget;
    deliveryId: string;
    queuedAt: string;
    envelope: SignedRemoteCommand;
  }>;
}

export interface HubConversationRemoteContinuationOptions {
  target: RemoteCommandTarget;
  destinationId: string;
  conversationIds: readonly string[];
  participantIds: readonly string[];
  roleId: string;
  provider: string;
  risk: "low" | "medium" | "high";
  verificationSuiteIds: readonly string[];
  lifetimeMs: number;
  submission: HubRemoteCommandSubmissionPort;
  resolveContinuation(input: {
    projectId: string;
    conversationId: string;
    threadId: string | null;
    eventId: string;
    participantId: string;
    requestContentHash: string;
    requestedAt: string;
  }): Promise<RemoteContinuationCoordinate>;
}

export type AuthenticatedHubConversationRemoteContinuationOptions = Omit<
  HubConversationRemoteContinuationOptions,
  "submission" | "resolveContinuation"
> & {
  http: Omit<RemoteCommandHttpSubmissionOptions, "destinationId" | "target">;
  assignmentId: string | null;
  agentId: string | null;
};

function sameContinuation(
  left: RemoteContinuationCoordinate | undefined,
  right: RemoteContinuationCoordinate,
): boolean {
  return (
    left?.workstreamId === right.workstreamId &&
    left.revision === right.revision &&
    left.snapshotContentHash === right.snapshotContentHash &&
    left.assignmentId === right.assignmentId &&
    left.agentId === right.agentId
  );
}

function idempotencyKey(input: {
  target: RemoteCommandTarget;
  eventId: string;
  participantId: string;
  requestContentHash: string;
  continuation: RemoteContinuationCoordinate;
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        target: input.target,
        eventId: input.eventId,
        participantId: input.participantId,
        requestContentHash: input.requestContentHash,
        continuation: input.continuation,
      }),
    )
    .digest("base64url");
  return `idk_${digest}`;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function uniqueBounded(values: readonly string[], pattern: RegExp): boolean {
  return (
    values.length > 0 &&
    values.length <= 64 &&
    new Set(values).size === values.length &&
    values.every((value) => pattern.test(value))
  );
}

export class HubConversationRemoteContinuation implements ConversationRemoteContinuationPort {
  private readonly conversations: ReadonlySet<string>;
  private readonly participants: ReadonlySet<string>;

  constructor(private readonly options: HubConversationRemoteContinuationOptions) {
    if (
      !uniqueBounded(options.conversationIds, /^cnv_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u) ||
      !uniqueBounded(options.participantIds, /^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u) ||
      options.verificationSuiteIds.length < 1 ||
      options.verificationSuiteIds.length > 16 ||
      new Set(options.verificationSuiteIds).size !== options.verificationSuiteIds.length ||
      !Number.isSafeInteger(options.lifetimeMs) ||
      options.lifetimeMs < 1_000 ||
      options.lifetimeMs > 5 * 60_000
    ) {
      throw new Error("The Hub conversation continuation configuration is invalid.");
    }
    this.conversations = new Set(options.conversationIds);
    this.participants = new Set(options.participantIds);
  }

  async request(
    input: Parameters<ConversationRemoteContinuationPort["request"]>[0],
  ): Promise<Awaited<ReturnType<ConversationRemoteContinuationPort["request"]>>> {
    if (
      input.projectId !== this.options.target.projectId ||
      !this.conversations.has(input.conversationId) ||
      !this.participants.has(input.participantId)
    ) {
      throw new Error("The conversation continuation source is outside the configured scope.");
    }
    if (
      sha256(input.request) !== input.requestContentHash ||
      !Number.isFinite(Date.parse(input.requestedAt))
    ) {
      throw new Error("The conversation continuation source evidence is invalid.");
    }
    const continuation = await this.options.resolveContinuation({
      projectId: input.projectId,
      conversationId: input.conversationId,
      threadId: input.threadId,
      eventId: input.eventId,
      participantId: input.participantId,
      requestContentHash: input.requestContentHash,
      requestedAt: input.requestedAt,
    });
    if (!isRemoteContinuationCoordinate(continuation)) {
      throw new Error("The resolved conversation continuation coordinate is invalid.");
    }
    const submitted = await this.options.submission.submit({
      idempotencyKey: idempotencyKey({
        target: this.options.target,
        eventId: input.eventId,
        participantId: input.participantId,
        requestContentHash: input.requestContentHash,
        continuation,
      }),
      lifetimeMs: this.options.lifetimeMs,
      roleId: this.options.roleId,
      provider: this.options.provider,
      risk: this.options.risk,
      verificationSuiteIds: [...this.options.verificationSuiteIds],
      request: input.request,
      continuation,
    });
    const action = submitted.envelope.command.action;
    if (
      submitted.destinationId !== this.options.destinationId ||
      action.kind !== "managed_run" ||
      action.roleId !== this.options.roleId ||
      action.provider !== this.options.provider ||
      action.risk !== this.options.risk ||
      action.request.contentHash !== input.requestContentHash ||
      action.verificationSuiteIds.length !== this.options.verificationSuiteIds.length ||
      action.verificationSuiteIds.some(
        (suiteId, index) => suiteId !== this.options.verificationSuiteIds[index],
      ) ||
      !sameContinuation(action.continuation, continuation)
    ) {
      throw new Error("The Hub-authored command differs from the conversation request binding.");
    }
    return {
      status: submitted.status === "created" ? "queued" : "duplicate",
      deliveryId: submitted.deliveryId,
      commandId: submitted.envelope.command.commandId,
      provider: action.provider,
      roleId: action.roleId,
      workstreamId: continuation.workstreamId,
      workstreamRevision: continuation.revision,
      workstreamSnapshotContentHash: continuation.snapshotContentHash,
      assignmentId: continuation.assignmentId,
      agentId: continuation.agentId,
      queuedAt: submitted.queuedAt,
    };
  }
}

export function createAuthenticatedHubConversationRemoteContinuation(
  options: AuthenticatedHubConversationRemoteContinuationOptions,
): HubConversationRemoteContinuation {
  const { http, assignmentId, agentId, ...continuation } = options;
  const workstreams = new HubWorkstreamContinuationResolver({
    target: options.target,
    destinationId: options.destinationId,
    expectedHubIdentityHash: http.expectedHubIdentityHash,
    assignmentId,
    agentId,
    transport: new AuthenticatedHubHttpTransport({
      baseUrl: http.baseUrl,
      bearerToken: http.bearerToken,
      expectedHubIdentityHash: http.expectedHubIdentityHash,
      destinationId: options.destinationId,
      target: options.target,
      ...(http.maxResponseBytes === undefined ? {} : { maxResponseBytes: http.maxResponseBytes }),
      ...(http.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: http.requestTimeoutMs }),
      ...(http.allowInsecureHttpForTests === undefined
        ? {}
        : { allowInsecureHttpForTests: http.allowInsecureHttpForTests }),
      ...(http.fetch === undefined ? {} : { fetch: http.fetch }),
    }),
  });
  return new HubConversationRemoteContinuation({
    ...continuation,
    resolveContinuation: () => workstreams.resolve(),
    submission: new AuthenticatedRemoteCommandHttpSubmission({
      ...http,
      destinationId: options.destinationId,
      target: options.target,
    }),
  });
}
