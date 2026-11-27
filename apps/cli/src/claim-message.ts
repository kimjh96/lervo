// The refusal's message (Lervo ADE coordination, "The message"): one paragraph that says what
// stopped, the path, the holder and where it works, until when, why, and what to do next.
import { MAX_CLAIM_REASON_CHARACTERS } from "@lervo/adapter-contract";

import type { ClaimHolder } from "./claim-contract.js";

const LISTED_PATHS = 3;
const CONFLICT_REASON =
  "Two agents changing one path in parallel conflict when their work integrates.";

/** The host's local `HH:MM` of an instant. */
export function localClockTime(instant: string): string {
  const time = new Date(instant);
  return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
}

function listed(paths: readonly string[]): string {
  const shown = paths.slice(0, LISTED_PATHS).map((path) => `\`${path}\``);
  const more = paths.length - shown.length;
  if (more > 0) return `${shown.join(", ")}, and ${more} more ${more === 1 ? "path" : "paths"}`;
  if (shown.length < 3) return shown.join(" and ");
  return `${shown.slice(0, -1).join(", ")}, and ${shown.at(-1)}`;
}

function who(holder: ClaimHolder): string {
  return holder.roleName === "" ? holder.displayName : `${holder.displayName} (${holder.roleName})`;
}

function where(holder: ClaimHolder): string {
  return holder.conversationTitle === null
    ? ""
    : ` in the conversation "${holder.conversationTitle}"`;
}

/** The choices a team holder leaves: mention it, other paths, or waiting for `waitFor`. */
function choices(holder: ClaimHolder, waitFor: string): string {
  return `Mention @${holder.displayName} with the change you need, continue with other paths, or ${waitFor}.`;
}

function heldMessage(
  code: string,
  subject: string,
  plural: boolean,
  holder: ClaimHolder,
  until: string | null,
): string | null {
  const these = plural ? "these paths" : "this path";
  const dontWrite = `Do not write ${these} another way.`;
  if (holder.origin === "lervo") {
    const owner = "Lervo's knowledge maintenance";
    const later = until === null ? "later" : `after ${until}`;
    return `${subject} ${plural ? "are" : "is"} claimed by ${owner}${until === null ? "" : ` until ${until}`}. ${CONFLICT_REASON} ${dontWrite} Continue with other paths, or try again ${later}.`;
  }
  const sealed = `try again after ${holder.displayName}'s change is sealed`;
  if (code === "path_leased")
    return `${subject} ${plural ? "are" : "is"} claimed by ${who(holder)}${where(holder)}${until === null ? "" : ` until ${until}`}. ${CONFLICT_REASON} ${dontWrite} ${choices(holder, sealed)}`;
  if (code === "path_changed_unsealed")
    return `${subject} ${plural ? "were" : "was"} changed by ${who(holder)}${where(holder)}, and that change is not sealed yet. ${CONFLICT_REASON} ${dontWrite} ${choices(holder, sealed)}`;
  if (code === "path_awaiting_integration")
    return `${subject} ${plural ? "are" : "is"} part of a sealed change by ${who(holder)}${where(holder)} that has not integrated yet. ${CONFLICT_REASON} ${dontWrite} ${choices(holder, "try again once that change integrates")}`;
  return null;
}

function unheldMessage(code: string, subject: string, plural: boolean): string {
  const be = plural ? "are" : "is";
  const these = plural ? "these paths" : "this path";
  if (code === "outside_responsibility")
    return `${subject} ${be} outside your responsibility paths. Do not write ${these} another way. Mention an agent whose responsibility covers ${plural ? "them" : "it"} with the change you need, or continue with other paths.`;
  if (code === "path_outside_workspace")
    return `${subject} ${be} in another checkout of this repository, outside this conversation's worktree. A write there would bypass the conversation's claims and could overwrite someone else's work. Write inside the conversation's own worktree instead.`;
  if (code === "lease_path_limit")
    return `This conversation's claims are at their limit, and ${subject} cannot join them without overlapping another holder. Seal the committed part of the change first with \`lervo workspace seal --write\`, then continue.`;
  return `${subject} ${be} held by another agent. Do not write ${these} another way. Continue with other paths.`;
}

/**
 * The message the agent receives for a refusal, at most the adapter's 2,048 characters. Times are
 * the host's local `HH:MM`. Lervo's own agents are never mentioned, so their refusals offer only
 * other paths or the time.
 */
export function claimRefusalMessage(input: {
  readonly code: string;
  readonly paths: readonly string[];
  readonly holder: ClaimHolder | null;
  readonly clockTime?: (instant: string) => string;
}): string {
  const subject = listed(input.paths);
  const plural = input.paths.length > 1;
  const holder = input.holder;
  const until =
    holder?.until === null || holder?.until === undefined
      ? null
      : (input.clockTime ?? localClockTime)(holder.until);
  const body =
    (holder === null ? null : heldMessage(input.code, subject, plural, holder, until)) ??
    unheldMessage(input.code, subject, plural);
  const message = `Lervo stopped this write. ${body}`;
  return message.length <= MAX_CLAIM_REASON_CHARACTERS
    ? message
    : `${message.slice(0, MAX_CLAIM_REASON_CHARACTERS - 1)}…`;
}
