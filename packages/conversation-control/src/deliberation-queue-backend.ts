import { createHash } from "node:crypto";

import type { ConversationDeliberationBackend } from "./deliberation-control.js";
import {
  assertConversationDeliberationSummary,
  conversationDeliberationPatterns,
  conversationDeliberationTimestamp,
  type ConversationDeliberationJob,
  type ConversationDeliberationJobStore,
} from "./deliberation-job.js";
import type {
  ConversationDeliberationResumeJob,
  ConversationDeliberationResumeJobStore,
} from "./deliberation-resume-job.js";
import type { ConversationDeliberationSummary } from "./types.js";
import { ConversationControlError } from "./types.js";

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertStartInput(input: Parameters<ConversationDeliberationBackend["start"]>[0]): void {
  if (
    !conversationDeliberationPatterns.projectId.test(input.projectId) ||
    !conversationDeliberationPatterns.sourceEventId.test(input.sourceEventId) ||
    !conversationDeliberationPatterns.policyId.test(input.policyId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(input.principalId) ||
    input.topic.length < 1 || input.topic.length > 4_096
  ) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      "숙의 queue 요청이 유효하지 않습니다.",
    );
  }
  conversationDeliberationTimestamp(input.requestedAt, "숙의 요청");
}

function idFor(projectId: string, sourceEventId: string): string {
  return `dlb_${digest(JSON.stringify(["conversation-deliberation", 1, projectId, sourceEventId]))
    .slice("sha256:".length, "sha256:".length + 32)}`;
}

function requestHash(input: Parameters<ConversationDeliberationBackend["start"]>[0]): string {
  return digest(JSON.stringify([
    "conversation-deliberation-request",
    1,
    input.projectId,
    input.sourceEventId,
    digest(input.principalId),
    input.policyId,
    input.topic,
  ]));
}

function summaryFor(
  job: ConversationDeliberationJob | ConversationDeliberationResumeJob,
  inspectedAt: string,
): ConversationDeliberationSummary {
  const inspectedAtMs = conversationDeliberationTimestamp(inspectedAt, "숙의 조회");
  if (job.state === "settled") {
    if (job.summary === null) {
      throw new ConversationControlError(
        "deliberation_source_failed",
        "종료된 숙의 queue 결과가 없습니다.",
      );
    }
    assertConversationDeliberationSummary(job.summary, job.deliberationId);
    return structuredClone(job.summary);
  }
  if (job.state === "uncertain" || (
    job.state === "leased" && job.leaseExpiresAt !== null &&
    conversationDeliberationTimestamp(job.leaseExpiresAt, "숙의 lease 만료") <= inspectedAtMs
  )) {
    return {
      deliberationId: job.deliberationId,
      status: "unknown",
      artifactCount: 0,
      nextAction: "none",
    };
  }
  return {
    deliberationId: job.deliberationId,
    status: "running",
    artifactCount: 0,
    nextAction: "wait",
  };
}

export class QueuedConversationDeliberationBackend implements ConversationDeliberationBackend {
  constructor(
    private readonly store: ConversationDeliberationJobStore,
    private readonly resumeStore?: ConversationDeliberationResumeJobStore,
  ) {}

  async start(input: Parameters<ConversationDeliberationBackend["start"]>[0]) {
    assertStartInput(input);
    const job = await this.store.enqueue({
      projectId: input.projectId,
      sourceEventId: input.sourceEventId,
      deliberationId: idFor(input.projectId, input.sourceEventId),
      requestHash: requestHash(input),
      principalHash: digest(input.principalId),
      policyId: input.policyId,
      topic: input.topic,
      requestedAt: input.requestedAt,
    });
    return summaryFor(job, input.requestedAt);
  }

  async inspect(input: Parameters<ConversationDeliberationBackend["inspect"]>[0]) {
    if (
      !conversationDeliberationPatterns.projectId.test(input.projectId) ||
      !conversationDeliberationPatterns.deliberationId.test(input.deliberationId)
    ) {
      throw new ConversationControlError(
        "deliberation_source_failed",
        "숙의 queue 조회 좌표가 유효하지 않습니다.",
      );
    }
    const resumed = await this.resumeStore?.inspect({
      projectId: input.projectId,
      deliberationId: input.deliberationId,
    });
    if (resumed !== undefined && resumed !== null) return summaryFor(resumed, input.inspectedAt);
    const job = await this.store.inspect({
      projectId: input.projectId,
      deliberationId: input.deliberationId,
    });
    if (job === null) {
      throw new ConversationControlError(
        "deliberation_source_failed",
        "요청한 숙의를 찾을 수 없습니다.",
      );
    }
    return summaryFor(job, input.inspectedAt);
  }

  async resume(input: Parameters<ConversationDeliberationBackend["resume"]>[0]) {
    if (
      !conversationDeliberationPatterns.projectId.test(input.projectId) ||
      !conversationDeliberationPatterns.sourceEventId.test(input.sourceEventId) ||
      !conversationDeliberationPatterns.deliberationId.test(input.deliberationId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(input.principalId)
    ) {
      throw new ConversationControlError(
        "deliberation_source_failed",
        "숙의 재개 queue 요청이 유효하지 않습니다.",
      );
    }
    conversationDeliberationTimestamp(input.requestedAt, "숙의 재개 요청");
    if (this.resumeStore === undefined) {
      throw new ConversationControlError(
        "deliberation_source_failed",
        "이 배포에는 숙의 재개 queue가 연결되지 않았습니다.",
      );
    }
    const original = await this.store.inspect({
      projectId: input.projectId,
      deliberationId: input.deliberationId,
    });
    if (original === null || summaryFor(original, input.requestedAt).status !== "interrupted") {
      throw new ConversationControlError(
        "deliberation_source_failed",
        "승인된 중단 상태로 확인된 숙의만 재개할 수 있습니다.",
      );
    }
    const requestDigest = digest(JSON.stringify([
      "conversation-deliberation-resume-request",
      1,
      input.projectId,
      input.sourceEventId,
      digest(input.principalId),
      input.deliberationId,
    ]));
    const job = await this.resumeStore.enqueue({
      projectId: input.projectId,
      sourceEventId: input.sourceEventId,
      deliberationId: input.deliberationId,
      requestHash: requestDigest,
      principalHash: digest(input.principalId),
      requestedAt: input.requestedAt,
    });
    return summaryFor(job, input.requestedAt);
  }
}
