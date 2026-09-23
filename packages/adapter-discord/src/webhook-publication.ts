import type { ConversationCoordination } from "@lervo/schemas";

type AudienceParticipation = "eligible" | "observe_only";

/** Webhooks have no authenticated nonce; only an explicit address may invite another agent turn. */
export function webhookInboundAudience(
  webhookAuthored: boolean,
  hasExplicitAddress: boolean,
  audienceParticipation: AudienceParticipation,
): AudienceParticipation {
  if (!webhookAuthored) return audienceParticipation;
  return hasExplicitAddress ? "eligible" : "observe_only";
}

/** A webhook result is presentation only; its co-resident control result travels separately. */
export function webhookCanPublish(input: {
  content: string;
  audienceParticipation: AudienceParticipation;
  coordination?: ConversationCoordination;
}): boolean {
  if (input.audienceParticipation === "eligible") return input.coordination === undefined;
  const normalizedContent = input.content.normalize("NFKC");
  if (/<@!?\d{1,32}>|<@&\d{1,32}>|(?:^|\s)@[^\s]/u.test(normalizedContent)) return false;
  return input.coordination === undefined || input.coordination.kind === "task.result";
}
