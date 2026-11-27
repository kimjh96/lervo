// The refusal's message (Lervo ADE coordination, "The message"): one paragraph that says what
// stopped, the path, the holder, until when, why, what to do next, and where the holder works. The
// guidance comes before the holder's conversation title, so a long message never loses it.
import { MAX_CLAIM_REASON_CHARACTERS } from "@lervo/adapter-contract";

import type { ClaimHolder } from "./claim-contract.js";

const LISTED_PATHS = 3;
/** The most characters of one path the message shows; a longer path keeps its start and end. */
const MAXIMUM_SHOWN_PATH_CHARACTERS = 200;
export const CONFLICT_REASON =
  "Two agents changing one path in parallel conflict when their work integrates.";

/** The host's local `HH:MM` of an instant. */
export function localClockTime(instant: string): string {
  const time = new Date(instant);
  return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
}

function shownPath(path: string): string {
  if (path.length <= MAXIMUM_SHOWN_PATH_CHARACTERS) return path;
  const half = (MAXIMUM_SHOWN_PATH_CHARACTERS - 1) / 2;
  return `${path.slice(0, Math.floor(half))}…${path.slice(-Math.ceil(half))}`;
}

/** Up to three paths in backquotes, and how many more. */
export function listedPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, LISTED_PATHS).map((path) => `\`${shownPath(path)}\``);
  const more = paths.length - shown.length;
  if (more > 0) return `${shown.join(", ")}, and ${more} more ${more === 1 ? "path" : "paths"}`;
  if (shown.length < 3) return shown.join(" and ");
  return `${shown.slice(0, -1).join(", ")}, and ${shown.at(-1)}`;
}

/** Whether `inner` lies strictly below the scope `outer`; `.` and `*` cover every path. */
function within(inner: string, outer: string): boolean {
  return outer === "." || outer === "*" || inner.startsWith(`${outer}/`);
}

/**
 * The paths a refusal names: the holder's own when they differ from the requested ones, with the
 * requested ones after them, so the agent knows which file is taken, such as
 * "`docs/a.md` (inside `docs`)".
 */
function refusedSubject(
  paths: readonly string[],
  heldPaths: readonly string[] | undefined,
): { readonly subject: string; readonly plural: boolean } {
  if (heldPaths === undefined || heldPaths.length === 0)
    return { subject: listedPaths(paths), plural: paths.length > 1 };
  const relates = (relation: (held: string, requested: string) => boolean) =>
    heldPaths.every((held) => paths.some((path) => held === path || relation(held, path)));
  const relation = relates(within)
    ? "inside"
    : relates((held, path) => within(path, held))
      ? "which contains"
      : "overlapping";
  return {
    subject: `${listedPaths(heldPaths)} (${relation} ${listedPaths(paths)})`,
    plural: heldPaths.length > 1,
  };
}

/** The holder's name with its role. */
export function holderLabel(holder: ClaimHolder): string {
  return holder.roleName === "" ? holder.displayName : `${holder.displayName} (${holder.roleName})`;
}

/** Where the holder works, after the guidance, or nothing when its conversation is unknown. */
function where(holder: ClaimHolder): string {
  return holder.conversationTitle === null
    ? ""
    : ` ${holder.displayName} works in the conversation "${holder.conversationTitle}".`;
}

/**
 * The choices a holder leaves: mentioning it when it is a team agent, other paths, or waiting for
 * `waitFor`. A holder of unknown origin is never mentioned.
 */
function choices(holder: ClaimHolder, waitFor: string): string {
  return holder.origin === "team"
    ? `Mention @${holder.displayName} with the change you need, continue with other paths, or ${waitFor}.`
    : `Continue with other paths, or ${waitFor}.`;
}

function heldMessage(
  code: string,
  subject: string,
  plural: boolean,
  holder: ClaimHolder,
  until: string | null,
): string | null {
  const these = plural ? "these paths" : "this path";
  const guidance = `${CONFLICT_REASON} Do not write ${these} another way.`;
  const untilTime = until === null ? "" : ` until ${until}`;
  if (holder.origin === "lervo") {
    const later = until === null ? "later" : `after ${until}`;
    return `${subject} ${plural ? "are" : "is"} claimed by Lervo's knowledge maintenance${untilTime}. ${guidance} Continue with other paths, or try again ${later}.`;
  }
  const sealed =
    holder.origin === "team"
      ? `try again after ${holder.displayName}'s change is sealed`
      : "try again after that change is sealed";
  if (code === "path_leased")
    return `${subject} ${plural ? "are" : "is"} claimed by ${holderLabel(holder)}${untilTime}. ${guidance} ${choices(holder, sealed)}${where(holder)}`;
  if (code === "path_changed_unsealed")
    return `${subject} ${plural ? "were" : "was"} changed by ${holderLabel(holder)}, and that change is not sealed yet. ${guidance} ${choices(holder, sealed)}${where(holder)}`;
  if (code === "path_awaiting_integration")
    return `${subject} ${plural ? "are" : "is"} part of a sealed change by ${holderLabel(holder)} that has not integrated yet. ${guidance} ${choices(holder, "try again once that change integrates")}${where(holder)}`;
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
  /** The holder's paths that overlap `paths`, when they differ from them. */
  readonly heldPaths?: readonly string[];
  readonly holder: ClaimHolder | null;
  readonly clockTime?: (instant: string) => string;
}): string {
  const { subject, plural } = refusedSubject(input.paths, input.heldPaths);
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
