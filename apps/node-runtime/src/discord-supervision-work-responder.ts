import { readConversationControlMessage } from "@lervo/conversation-control";
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

export function discordSupervisionIntakeEffectResult(
  outcome: Exclude<DiscordSupervisionIntakeOutcome, { status: "bound" }>,
): {
  effectId: string;
  resultCode: string;
  targetLabel: string;
  facts: string[];
} {
  switch (outcome.status) {
    case "duplicate":
      return {
        effectId: "supervision_goal_request",
        resultCode: "already_bound",
        targetLabel: "the requested durable goal",
        facts: [
          "The exact request was already bound to the supervised workstream.",
          "No duplicate binding or work execution was created.",
        ],
      };
    case "refused": {
      const facts: Record<typeof outcome.code, string[]> = {
        request_invalid: [
          "The request did not satisfy the supervised intake contract.",
          "It was not bound and no work started from it.",
        ],
        identity_conflict: [
          "The request identity conflicts with existing supervised intake evidence.",
          "It was not bound and no work started from it.",
        ],
        origin_conflict: [
          "The current supervised workstream is already bound to a different source request.",
          "This request was not bound and no work started from it.",
        ],
        workstream_inactive: [
          "There is no active supervised workstream that can accept this request.",
          "This request was not bound and no work started from it.",
        ],
        owner_busy: [
          "The supervision owner did not become available before the bounded admission deadline.",
          "This request was not recorded and no work started from it.",
        ],
        authority_changed: [
          "The installed supervision authority changed while this request was being admitted.",
          "It was not bound and no work started from it.",
        ],
        evidence_changed: [
          "The supervised intake evidence changed while this request was being admitted.",
          "It was not bound and no work started from it.",
        ],
      };
      return {
        effectId: "supervision_goal_request",
        resultCode: outcome.code,
        targetLabel: "the requested durable goal",
        facts: facts[outcome.code],
      };
    }
  }
}

/** Converts one admitted Discord work turn into the same canonical goal intake as local supervision. */
export class DiscordSupervisionWorkResponder implements ConversationResponder {
  constructor(
    private readonly options: {
      repositoryRoot: string;
      projectId: string;
      artifactStore: ArtifactStore;
      resultResponder: ConversationResponder;
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
    return this.options.resultResponder.respond({
      ...input,
      context: {
        priorTurns: input.context?.priorTurns ?? [],
        completedEffect:
          outcome.status === "bound"
            ? {
                effectId: "supervision_goal_request",
                resultCode: "bound",
                targetLabel: "the requested durable goal",
                facts: [
                  "The request was newly bound to the current supervised workstream.",
                  "The binding is ready for supervised execution.",
                ],
              }
            : discordSupervisionIntakeEffectResult(outcome),
      },
    });
  }
}
