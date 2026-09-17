import { createHash } from "node:crypto";

const eligiblePrefix = "lv1e_";
const observeOnlyPrefix = "lv1o_";
const suffixLength = 20;
const classifiedNonce = /^lv1([eo])_[A-Za-z0-9_-]{20}$/u;

export type DiscordAudienceParticipation = "eligible" | "observe_only";

export function createDiscordMessageNonce(
  outboundId: string,
  audienceParticipation: DiscordAudienceParticipation,
): string {
  const suffix = createHash("sha256").update(outboundId).digest("base64url").slice(0, suffixLength);
  return `${audienceParticipation === "observe_only" ? observeOnlyPrefix : eligiblePrefix}${suffix}`;
}

export function readDiscordAudienceParticipation(input: {
  nonce: unknown;
  agentAuthored: boolean;
}): DiscordAudienceParticipation {
  if (!input.agentAuthored || typeof input.nonce !== "string") return "eligible";
  const match = classifiedNonce.exec(input.nonce);
  return match?.[1] === "o" ? "observe_only" : "eligible";
}
