import {
  readConversationControlMessage,
  createVerifiedConversationControlReply,
} from "@lervo/conversation-control";
import { realtimeConversationWritingContract } from "@lervo/core";
import type { ConversationReplyCandidate, ConversationResponder } from "@lervo/interaction";
import type { ConversationAgentBinding } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";

import {
  admitStandingSupervisionRequest,
  admitSupervisionRequest,
} from "./supervision-request-intake.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { supervisionRequestRefusalCode } from "./supervision-request-refusal.js";
import type { NodeSupervisionStartupConfiguration } from "./supervision-startup-config.js";

/** One idle owner cycle can hold the fence for about a minute; two cycles bound the Discord wait. */
const DISCORD_ADMISSION_DEADLINE_MS = 120_000;

type DiscordSupervisionIntakeOutcome =
  | { status: "bound" }
  | { status: "duplicate" }
  | { status: "refused"; code: NonNullable<ReturnType<typeof supervisionRequestRefusalCode>> };

class SupervisionAdmissionUnconfirmedError extends Error {
  readonly code = "supervision_admission_unconfirmed";

  constructor(cause: unknown) {
    super("The supervision request admission outcome could not be confirmed.", { cause });
    this.name = "SupervisionAdmissionUnconfirmedError";
  }
}

const REFUSAL_MESSAGES: Partial<
  Record<NonNullable<ReturnType<typeof supervisionRequestRefusalCode>>, string>
> = {
  origin_conflict:
    "현재 목표에는 이미 다른 요청이 연결되어 있어 이 요청을 연결하지 않았습니다. 새 요청은 별도 목표로 접수해야 합니다.",
  workstream_inactive: "연결할 활성 목표가 없어 요청을 연결하지 않았습니다.",
  owner_busy:
    "담당자가 작업 중이어서 제한 시간 안에 요청을 연결하지 못했습니다. 요청은 기록되지 않았으니 잠시 후 다시 시도해 주세요.",
};

export function discordSupervisionIntakeStatusMessage(
  outcome: Exclude<DiscordSupervisionIntakeOutcome, { status: "bound" }>,
): string {
  switch (outcome.status) {
    case "duplicate":
      return "동일한 요청은 이미 담당자의 작업 목표에 연결되어 있습니다.";
    case "refused":
      return (
        REFUSAL_MESSAGES[outcome.code] ??
        `요청을 현재 목표에 연결하지 않았습니다. 사유 코드는 ${outcome.code}입니다.`
      );
  }
}

/** Converts one admitted Discord work turn into the same canonical goal intake as local supervision. */
export class DiscordSupervisionWorkResponder implements ConversationResponder {
  constructor(
    private readonly options: {
      repositoryRoot: string;
      projectId: string;
      artifactStore: ArtifactStore;
      configuration: NodeSupervisionStartupConfiguration;
      policyId: string;
      speaker: { participantId: string; roleId: string; agentBinding?: ConversationAgentBinding };
      authorizedEffectRequesters: readonly {
        participantId: string;
        roleId: string;
        conversationId: string;
      }[];
      admitRequest?: typeof admitSupervisionRequest;
      admitStandingRequest?: typeof admitStandingSupervisionRequest;
      admissionDeadlineMs?: number;
      /** Standing lineage: the runtime follows the binding a successor transition returns. */
      onRebound?(binding: NodeSupervisionBinding): Promise<void>;
    },
  ) {}

  async respond(
    input: Parameters<ConversationResponder["respond"]>[0],
    admittedReplyCandidate: ConversationReplyCandidate | null = null,
  ) {
    const event = input.event;
    const authorized =
      event.actor.kind === "human" ||
      this.options.authorizedEffectRequesters.some(
        (requester) =>
          requester.participantId === event.actor.participantId &&
          requester.roleId === event.actor.roleId &&
          requester.conversationId === event.target.conversationId,
      );
    if (!authorized || event.target.projectId !== this.options.projectId)
      throw new Error("The supervised conversation requester is not authorized.");
    const request = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event,
    });
    const origin = {
      sourceEventId: event.eventId,
      policyId: this.options.policyId,
      target: event.target,
      actor: {
        kind: "agent" as const,
        participantId: this.options.speaker.participantId,
        roleId: this.options.speaker.roleId,
        ...(this.options.speaker.agentBinding === undefined
          ? {}
          : { agentBinding: this.options.speaker.agentBinding }),
      },
    };
    if (
      this.options.configuration.resultOrigin !== undefined &&
      operatingContractHash(this.options.configuration.resultOrigin) !==
        operatingContractHash(origin)
    )
      throw new Error("The supervised conversation differs from its installed result origin.");
    let outcome: DiscordSupervisionIntakeOutcome;
    const requestInput = {
      source: "discord" as const,
      sourceId: event.eventId,
      requesterId: `${event.actor.participantId}:${event.actor.roleId}`,
      request,
      contentHash: event.content.contentHash,
      origin,
    };
    const admissionDeadlineMs = this.options.admissionDeadlineMs ?? DISCORD_ADMISSION_DEADLINE_MS;
    try {
      let admission: { eventId: string; duplicate: boolean };
      if (this.options.configuration.standing) {
        const standing = await (
          this.options.admitStandingRequest ?? admitStandingSupervisionRequest
        )({
          repositoryRoot: this.options.repositoryRoot,
          root: this.options.configuration.binding,
          request: requestInput,
          provider: this.options.configuration.ownerReasoning.provider,
          admissionDeadlineMs,
        });
        if (standing.rebound) await this.options.onRebound?.(standing.binding);
        admission = standing;
      } else {
        admission = await (this.options.admitRequest ?? admitSupervisionRequest)({
          repositoryRoot: this.options.repositoryRoot,
          binding: this.options.configuration.binding,
          request: requestInput,
          admissionDeadlineMs,
        });
      }
      outcome = { status: admission.duplicate ? "duplicate" : "bound" };
    } catch (error) {
      const code = supervisionRequestRefusalCode(error);
      if (code === null) throw new SupervisionAdmissionUnconfirmedError(error);
      outcome = { status: "refused", code };
    }
    if (outcome.status === "bound" && admittedReplyCandidate !== null) {
      return admittedReplyCandidate;
    }
    if (outcome.status === "bound" && event.kind !== "goal.requested") {
      throw new Error("A natural-language supervision admission requires its managed reply.");
    }
    return createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: realtimeConversationWritingContract,
      content:
        outcome.status === "bound"
          ? "기존 목표 요청을 현재 작업 목표에 연결했습니다."
          : discordSupervisionIntakeStatusMessage(outcome),
    });
  }
}
