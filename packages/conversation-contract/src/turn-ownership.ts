import type { ConversationInboundEvent } from "@lervo/schemas";

import { assertConversationInboundEvent } from "./event.js";
import { ConversationContractError } from "./errors.js";
import { digest } from "./shared.js";

export interface ConversationTurnCandidate {
  participantId: string;
  roleId: string;
}

export interface ConversationTurnOwnership {
  basis: "participant_mentions" | "role_mentions" | "unaddressed" | "no_candidates";
  candidateParticipantIds: string[];
  ownerParticipantIds: string[];
}

function assertCandidates(candidates: readonly ConversationTurnCandidate[]): void {
  const participantIds = candidates.map((candidate) => candidate.participantId);
  if (
    new Set(participantIds).size !== participantIds.length ||
    candidates.some(
      (candidate) =>
        !/^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(candidate.participantId) ||
        !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(candidate.roleId) ||
        candidate.roleId.length > 100,
    )
  ) {
    throw new ConversationContractError(
      "invalid_participation_policy",
      "Conversation turn ownership candidates are invalid.",
    );
  }
}

function selectWinner(
  event: ConversationInboundEvent,
  scope: string,
  candidates: readonly ConversationTurnCandidate[],
): ConversationTurnCandidate {
  return [...candidates].sort((left, right) => {
    const leftScore = digest(
      `${event.sourceEventKeyHash}\0${event.target.conversationId}\0${scope}\0${left.participantId}`,
    );
    const rightScore = digest(
      `${event.sourceEventKeyHash}\0${event.target.conversationId}\0${scope}\0${right.participantId}`,
    );
    return (
      rightScore.localeCompare(leftScore) || left.participantId.localeCompare(right.participantId)
    );
  })[0]!;
}

export function resolveConversationTurnOwnership(input: {
  event: ConversationInboundEvent;
  candidates: readonly ConversationTurnCandidate[];
}): ConversationTurnOwnership {
  assertConversationInboundEvent(input.event);
  assertCandidates(input.candidates);
  const candidates = [...input.candidates]
    .filter((candidate) => candidate.participantId !== input.event.actor.participantId)
    .sort((left, right) => left.participantId.localeCompare(right.participantId));
  if (candidates.length === 0) {
    return { basis: "no_candidates", candidateParticipantIds: [], ownerParticipantIds: [] };
  }

  const participantMentions = new Set(input.event.mentions.participantIds);
  const participantOwners = candidates.filter((candidate) =>
    participantMentions.has(candidate.participantId),
  );
  if (participantOwners.length > 0) {
    return {
      basis: "participant_mentions",
      candidateParticipantIds: candidates.map((candidate) => candidate.participantId),
      ownerParticipantIds: participantOwners.map((candidate) => candidate.participantId),
    };
  }

  const mentionedRoles = new Set(input.event.mentions.roleIds);
  const roleOwners = [...mentionedRoles]
    .sort()
    .flatMap((roleId) => {
      const roleCandidates = candidates.filter((candidate) => candidate.roleId === roleId);
      return roleCandidates.length === 0
        ? []
        : [selectWinner(input.event, `role:${roleId}`, roleCandidates).participantId];
    })
    .filter((participantId, index, values) => values.indexOf(participantId) === index)
    .sort();
  if (roleOwners.length > 0) {
    return {
      basis: "role_mentions",
      candidateParticipantIds: candidates.map((candidate) => candidate.participantId),
      ownerParticipantIds: roleOwners,
    };
  }

  return {
    basis: "unaddressed",
    candidateParticipantIds: candidates.map((candidate) => candidate.participantId),
    ownerParticipantIds: [selectWinner(input.event, "unaddressed", candidates).participantId],
  };
}
