// The turn's end message for changes that conflict (Lervo ADE coordination, "Reconciliation"):
// `Stop` blocks once and names each path and its holder, so the agent can mention the holder or
// say what waits on it before the turn ends.
import { MAX_CLAIM_REASON_CHARACTERS } from "@lervo/adapter-contract";

import type { ClaimHolder } from "./claim-contract.js";
import { CONFLICT_REASON, holderLabel, listedPaths, localClockTime } from "./claim-message.js";
import type { ReconciliationConflict } from "./conversation-reconciliation.js";

/** The most holders the message names; the rest are counted. */
const NAMED_CONFLICTS = 6;

function inConversation(holder: ClaimHolder): string {
  return holder.conversationTitle === null ? "" : ` in "${holder.conversationTitle}"`;
}

function heldSentence(
  conflict: ReconciliationConflict,
  holder: ClaimHolder,
  clockTime: (instant: string) => string,
): string {
  const subject = listedPaths(conflict.paths);
  const plural = conflict.paths.length > 1;
  const until = holder.until === null ? "" : ` until ${clockTime(holder.until)}`;
  if (holder.origin === "lervo")
    return `${subject} ${plural ? "are" : "is"} claimed by Lervo's knowledge maintenance${until}.`;
  if (conflict.code === "path_changed_unsealed")
    return `${subject} ${plural ? "were" : "was"} changed by ${holderLabel(holder)}${inConversation(holder)}, and that change is not sealed yet.`;
  if (conflict.code === "path_awaiting_integration")
    return `${subject} ${plural ? "are" : "is"} part of a sealed change by ${holderLabel(holder)}${inConversation(holder)} that has not integrated yet.`;
  return `${subject} ${plural ? "are" : "is"} claimed by ${holderLabel(holder)}${until}${inConversation(holder)}.`;
}

function sentence(
  conflict: ReconciliationConflict,
  clockTime: (instant: string) => string,
): string {
  if (conflict.holder !== null) return heldSentence(conflict, conflict.holder, clockTime);
  const subject = listedPaths(conflict.paths);
  const be = conflict.paths.length > 1 ? "are" : "is";
  if (conflict.code === "outside_responsibility")
    return `${subject} ${be} outside your responsibility paths.`;
  if (conflict.code === "lease_path_limit")
    return `${subject} cannot join this conversation's claims, which are at their limit; seal the committed part of the change first with \`lervo workspace seal --write\`.`;
  return `${subject} ${be} held by another agent.`;
}

/** Who the agent may mention: team holders only, since Lervo's own agents are never mentioned. */
function guidance(conflicts: readonly ReconciliationConflict[]): string {
  const mentioned = [
    ...new Set(
      conflicts.flatMap((conflict) =>
        conflict.holder?.origin === "team" ? [`@${conflict.holder.displayName}`] : [],
      ),
    ),
  ];
  return mentioned.length === 0
    ? "End your turn saying what waits on these paths."
    : `Mention ${mentioned.join(" and ")} with the change you need, or end your turn saying what waits on ${mentioned.length === 1 ? "it" : "them"}.`;
}

/**
 * The `Stop` block's reason for a reconciliation's conflicts, at most 2,048 characters. Times are
 * the host's local `HH:MM`.
 */
export function reconciliationMessage(
  conflicts: readonly ReconciliationConflict[],
  clockTime: (instant: string) => string = localClockTime,
): string {
  const named = conflicts
    .slice(0, NAMED_CONFLICTS)
    .map((conflict) => sentence(conflict, clockTime));
  const more = conflicts.length - named.length;
  const message = [
    "Lervo found changes in this turn that conflict with other work.",
    ...named,
    ...(more > 0 ? [`${more} more ${more === 1 ? "holder" : "holders"} also conflict.`] : []),
    `${CONFLICT_REASON} Do not write these paths another way.`,
    guidance(conflicts),
    "Lervo checks again when this turn ends: what still conflicts then stays unresolved, and sealing waits until it resolves.",
  ].join(" ");
  return message.length <= MAX_CLAIM_REASON_CHARACTERS
    ? message
    : `${message.slice(0, MAX_CLAIM_REASON_CHARACTERS - 1)}…`;
}
