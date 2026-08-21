import { createHash } from "node:crypto";

import type { ConversationReplyCandidate } from "@lervo/interaction";
import type { ConversationInboundEvent } from "@lervo/schemas";
import {
  evaluateWritingPublication,
  readPublishableWritingArtifact,
  type WritingArtifactCoordinate,
} from "@lervo/writing";

import { parseConversationControlCommand } from "./parser.js";
import type {
  ConversationControlResponderOptions,
  ConversationDeliberationSummary,
  ParsedConversationControlCommand,
} from "./types.js";
import { ConversationControlError } from "./types.js";

function timestamp(now: () => Date): string {
  const value = now();
  if (!Number.isFinite(value.getTime())) {
    throw new ConversationControlError("control_command_invalid", "Conversation control 시각이 유효하지 않습니다.");
  }
  return value.toISOString();
}

async function readMessage(options: ConversationControlResponderOptions,
  event: ConversationInboundEvent): Promise<string> {
  const uri = `lervo-cas://sha256/${event.content.contentHash.slice("sha256:".length)}`;
  try {
    const bytes = new Uint8Array(await options.artifactStore.get(uri));
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (bytes.byteLength !== event.content.byteCount || hash !== event.content.contentHash) {
      throw new Error("message artifact mismatch");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ConversationControlError(
      "message_artifact_invalid",
      "Control 명령 원문을 안전하게 읽지 못했습니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

function statusLabel(status: string): string {
  return ({
    pending: "실행 대기",
    leased: "Node 전달 중",
    completed: "실행 완료",
    rejected: "실행 거부",
    expired: "기한 만료",
  } as Record<string, string>)[status] ?? status;
}

function approvalLabel(status: string): string {
  return ({
    unavailable: "정책을 확인할 수 없음",
    denied: "정책에서 거부됨",
    not_required: "별도 승인 불필요",
    approval_required: "승인 필요",
    partially_approved: "일부 범위 승인됨",
    approved: "필요 범위 승인됨",
  } as Record<string, string>)[status] ?? status;
}

function render(input: Awaited<ReturnType<ConversationControlResponderOptions["control"]["inspect"]>>,
  approvalReview: boolean): string {
  const review = input.review;
  const lines = [
    `Command ${review.delivery.commandId}은 현재 ${statusLabel(review.delivery.status)} 상태입니다.`,
    `실행 역할은 ${review.command.roleId}, 공급자는 ${review.command.provider}, 위험도는 ${review.command.risk}입니다. 승인 상태는 ${approvalLabel(review.approval.state)}입니다.`,
  ];
  if (approvalReview) {
    if (input.reviewUrl === null) {
      throw new ConversationControlError("control_source_failed", "승인 검토 주소가 없습니다.");
    }
    lines.push(
      `이 대화에서는 승인이 생성되지 않았습니다. 다음 Hub 화면에서 다시 인증하고 범위를 확인해야 승인할 수 있습니다: ${input.reviewUrl}`,
    );
  } else {
    lines.push("추가 작업이 필요하면 `/lervo approval <delivery-id>` 형식으로 승인 검토 화면을 요청할 수 있습니다.");
  }
  return lines.join("\n\n");
}

function deliberationStatusLabel(status: ConversationDeliberationSummary["status"]): string {
  return ({
    running: "진행 중",
    interrupted: "재개 대기",
    converged: "결론 도달",
    no_consensus: "합의 없음",
    failed: "실패",
  } as const)[status];
}

function renderDeliberation(summary: ConversationDeliberationSummary, started: boolean): string {
  const lines = [
    started
      ? `숙의 ${summary.deliberationId} 요청을 처리했습니다.`
      : `숙의 ${summary.deliberationId}은 현재 ${deliberationStatusLabel(summary.status)} 상태입니다.`,
    `기록된 산출물은 ${summary.artifactCount}개입니다.`,
  ];
  if (summary.nextAction === "wait") lines.push("현재 작업이 끝날 때까지 기다려 주세요.");
  if (summary.nextAction === "resume") {
    lines.push("재개 권한이 있는 실행 경로에서 승인된 경계부터 이어갈 수 있습니다.");
  }
  return lines.join("\n\n");
}

function assertDeliberationSummary(
  summary: ConversationDeliberationSummary,
  expectedId?: string,
): void {
  const nextActionMatches = summary.status === "running"
    ? summary.nextAction === "wait"
    : summary.status === "interrupted"
      ? summary.nextAction === "resume"
      : summary.nextAction === "none";
  if (
    !/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(summary.deliberationId) ||
    (expectedId !== undefined && summary.deliberationId !== expectedId) ||
    !Number.isSafeInteger(summary.artifactCount) || summary.artifactCount < 0 ||
    summary.artifactCount > 10_000 || !nextActionMatches
  ) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      "숙의 서비스가 유효하지 않은 상태를 반환했습니다.",
    );
  }
}

async function executeCommand(
  options: ConversationControlResponderOptions,
  event: ConversationInboundEvent,
  command: ParsedConversationControlCommand,
  at: string,
): Promise<string> {
  if ("deliveryId" in command) {
    const controlled = await options.control.inspect({
      event,
      operation: command.operation,
      deliveryId: command.deliveryId,
      inspectedAt: at,
    });
    return render(controlled, command.operation === "approval_review");
  }
  if (options.deliberations === undefined) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      "이 배포에는 숙의 서비스가 연결되지 않았습니다.",
    );
  }
  try {
    const summary = command.operation === "deliberation_start"
      ? await options.deliberations.start({
          event,
          policyId: command.policyId,
          topic: command.topic,
          requestedAt: at,
        })
      : await options.deliberations.inspect({
          event,
          deliberationId: command.deliberationId,
          inspectedAt: at,
        });
    assertDeliberationSummary(
      summary,
      command.operation === "deliberation_status" ? command.deliberationId : undefined,
    );
    return renderDeliberation(summary, command.operation === "deliberation_start");
  } catch (error) {
    if (error instanceof ConversationControlError) throw error;
    throw new ConversationControlError(
      "deliberation_source_failed",
      "숙의를 시작하거나 상태를 조회하지 못했습니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

async function storeWriting(options: ConversationControlResponderOptions,
  content: string): Promise<WritingArtifactCoordinate> {
  const bytes = Buffer.from(content, "utf8");
  const stored = await options.artifactStore.put(bytes);
  return {
    artifactId: `art_${stored.contentHash.slice("sha256:".length)}`,
    uri: stored.uri,
    mediaType: "text/markdown; charset=utf-8",
    contentHash: stored.contentHash,
    byteCount: stored.byteCount,
  };
}

export class ConversationControlResponder {
  private readonly now: () => Date;

  constructor(private readonly options: ConversationControlResponderOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async respond(input: Parameters<import("@lervo/interaction").ConversationResponder["respond"]>[0]):
    Promise<ConversationReplyCandidate> {
    const parsed = parseConversationControlCommand(await readMessage(this.options, input.event));
    if (parsed === null) {
      throw new ConversationControlError(
        "control_command_invalid",
        "명시적인 Lervo control 명령이 아닙니다.",
      );
    }
    const inspectedAt = timestamp(this.now);
    const artifact = await storeWriting(
      this.options,
      await executeCommand(this.options, input.event, parsed, inspectedAt),
    );
    const publication = await evaluateWritingPublication({
      artifact,
      contract: this.options.writingContract,
      surface: "chat",
      artifactStore: this.options.artifactStore,
      semanticEvaluator: this.options.semanticEvaluator,
    }, { now: this.now });
    if (publication.status !== "allowed") {
      throw new ConversationControlError(
        "writing_publication_blocked",
        "Hub control 응답이 writing 공개 검증을 통과하지 못했습니다.",
      );
    }
    await readPublishableWritingArtifact({
      artifact,
      evaluation: publication.evaluation,
      evaluationArtifact: publication.evaluationArtifact,
      permit: publication.permit,
      contract: this.options.writingContract,
      surface: "chat",
      artifactStore: this.options.artifactStore,
    });
    return {
      content: {
        artifactId: artifact.artifactId,
        contentHash: artifact.contentHash,
        byteCount: artifact.byteCount,
        mediaType: artifact.mediaType,
      },
      publicationPermit: publication.permit,
      publicationEvidence: {
        artifact,
        evaluation: publication.evaluation,
        evaluationArtifact: publication.evaluationArtifact,
      },
    };
  }
}
