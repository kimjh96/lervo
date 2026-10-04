import { readResourceUsageEventPayload } from "@lervo/execution-contract";
import type { DeliberationArtifact, EventEnvelope } from "@lervo/schemas";
import { visitEventSnapshot, type EventStore } from "@lervo/storage-contract";

/**
 * ADR-0460: an artifact is `verified` only when its producing run recorded complete
 * `deliberation`-scope usage for the producing provider. Prose, role names, and partial or
 * unavailable counters never prove that a provider participated.
 */
export type DeliberationUsageVerification = "verified" | "unverified";

export function deliberationArtifactUsageVerification(input: {
  runId: string;
  provider: string;
  runEvents: readonly EventEnvelope[];
}): DeliberationUsageVerification {
  const verified = input.runEvents.some((event) => {
    if (event.runId !== input.runId) return false;
    const payload = readResourceUsageEventPayload(event);
    return (
      payload !== null &&
      payload.scope === "deliberation" &&
      payload.status === "observed" &&
      payload.usage !== null &&
      (payload.modelIdentity?.provider ?? event.actor.provider) === input.provider
    );
  });
  return verified ? "verified" : "unverified";
}

/** Counts participant roles whose every recorded artifact has verified usage. */
export function verifiedDeliberationParticipantCount(
  artifacts: readonly DeliberationArtifact[],
  verification: ReadonlyMap<string, DeliberationUsageVerification>,
): number {
  const roles = new Map<string, boolean>();
  for (const artifact of artifacts) {
    const verified = verification.get(artifact.deliberationArtifactId) === "verified";
    roles.set(artifact.producer.roleId, (roles.get(artifact.producer.roleId) ?? true) && verified);
  }
  return [...roles.values()].filter(Boolean).length;
}

/**
 * Reads whether a recorded deliberation proves the opinions of more than one provider: every
 * recorded artifact is verified and verified artifacts come from at least two providers.
 */
export function deliberationProvesMultipleProviders(input: {
  events: Pick<EventStore, "list" | "latest">;
  deliberationId: string;
}): boolean {
  let recorded = 0;
  let unverified = 0;
  const providers = new Set<string>();
  visitEventSnapshot({
    events: input.events,
    throughSeq: input.events.latest()?.seq ?? 0,
    visit: (event) => {
      if (
        event.type !== "deliberation.artifact.recorded" ||
        event.payload.deliberationId !== input.deliberationId
      )
        return;
      recorded += 1;
      if (event.payload.usageVerification !== "verified") {
        unverified += 1;
        return;
      }
      if (event.actor.provider !== undefined) providers.add(event.actor.provider);
    },
  });
  return recorded > 0 && unverified === 0 && providers.size >= 2;
}
