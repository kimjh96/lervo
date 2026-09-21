import { createHash } from "node:crypto";

const eligiblePrefix = "lv1e_";
const observeOnlyPrefix = "lv1o_";
const suffixLength = 20;
const classifiedNonce = /^lv1([eo])_[A-Za-z0-9_-]{20}$/u;
const coordinatedNonce = /^lv1([acfntr])_([A-Za-z0-9_-]{20})$/u;

export type DiscordAudienceParticipation = "eligible" | "observe_only";
export type DiscordMessageCoordination =
  | {
      kind: "discussion.assignment";
      discussionId: string;
      assignmentSequence?: 1 | 2;
    }
  | {
      kind: "discussion.contribution";
      discussionId: string;
    }
  | {
      kind: "discussion.decision";
      discussionId: string;
    }
  | {
      kind: "task.assignment";
      taskId: string;
    }
  | {
      kind: "task.result";
      taskId: string;
    };

export function createDiscordMessageNonce(
  outboundId: string,
  audienceParticipation: DiscordAudienceParticipation,
  coordination?: DiscordMessageCoordination,
): string {
  if (coordination !== undefined) {
    const coordinate =
      coordination.kind === "task.assignment" || coordination.kind === "task.result"
        ? coordination.taskId
        : coordination.discussionId;
    const match = /^(?:dsc|tsk)_([A-Za-z0-9_-]{20})$/u.exec(coordinate ?? "");
    if (match === null) throw new Error("The Discord coordination coordinate is invalid.");
    const kind =
      coordination.kind === "discussion.assignment"
        ? coordination.assignmentSequence === 2
          ? "n"
          : "a"
        : coordination.kind === "discussion.contribution"
          ? "c"
          : coordination.kind === "discussion.decision"
            ? "f"
            : coordination.kind === "task.assignment"
              ? "t"
              : "r";
    return `lv1${kind}_${match[1]}`;
  }
  const suffix = createHash("sha256").update(outboundId).digest("base64url").slice(0, suffixLength);
  return `${audienceParticipation === "observe_only" ? observeOnlyPrefix : eligiblePrefix}${suffix}`;
}

export function readDiscordMessageCoordination(input: {
  nonce: unknown;
  agentAuthored: boolean;
}): DiscordMessageCoordination | null {
  if (!input.agentAuthored || typeof input.nonce !== "string") return null;
  const match = coordinatedNonce.exec(input.nonce);
  if (match === null) return null;
  if (match[1] === "t" || match[1] === "r") {
    return {
      kind: match[1] === "t" ? "task.assignment" : "task.result",
      taskId: `tsk_${match[2]}`,
    };
  }
  if (match[1] === "a" || match[1] === "n") {
    return {
      kind: "discussion.assignment",
      discussionId: `dsc_${match[2]}`,
      assignmentSequence: match[1] === "n" ? 2 : 1,
    };
  }
  return {
    kind: match[1] === "c" ? "discussion.contribution" : "discussion.decision",
    discussionId: `dsc_${match[2]}`,
  };
}

export function readDiscordAudienceParticipation(input: {
  nonce: unknown;
  agentAuthored: boolean;
}): DiscordAudienceParticipation {
  if (!input.agentAuthored || typeof input.nonce !== "string") return "eligible";
  if (coordinatedNonce.exec(input.nonce)?.[1] === "f") return "observe_only";
  const match = classifiedNonce.exec(input.nonce);
  return match?.[1] === "o" ? "observe_only" : "eligible";
}
