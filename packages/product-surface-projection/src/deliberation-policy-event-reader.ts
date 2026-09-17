import { deliberationPolicyHash } from "@lervo/deliberation";
import type { DeliberationPolicy, EventEnvelope } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

export type DeliberationPolicyEventSource =
  | {
      status: "complete";
      policy: DeliberationPolicy;
      startedEventId: string;
      reasonCode: null;
    }
  | {
      status: "unavailable" | "invalid";
      policy: null;
      startedEventId: string | null;
      reasonCode: "deliberation_policy_unavailable" | "deliberation_policy_event_invalid";
    };

export function readDeliberationPolicyEvent(input: {
  projectId: string;
  deliberationId: string;
  events: readonly EventEnvelope[];
}): DeliberationPolicyEventSource {
  const started = input.events.filter(
    (event) =>
      event.type === "deliberation.started" &&
      event.payload.deliberationId === input.deliberationId,
  );
  if (started.length !== 1) {
    return {
      status: started.length === 0 ? "unavailable" : "invalid",
      policy: null,
      startedEventId: started[0]?.eventId ?? null,
      reasonCode:
        started.length === 0
          ? "deliberation_policy_unavailable"
          : "deliberation_policy_event_invalid",
    };
  }
  const event = started[0]!;
  const payload = event.payload as Record<string, unknown>;
  if (
    event.projectId !== input.projectId ||
    event.actor.kind !== "system" ||
    !validateSchema("deliberationStartedEventPayload", payload).valid
  ) {
    return {
      status: "invalid",
      policy: null,
      startedEventId: event.eventId,
      reasonCode: "deliberation_policy_event_invalid",
    };
  }
  if (payload.policy === undefined) {
    return {
      status: "unavailable",
      policy: null,
      startedEventId: event.eventId,
      reasonCode: "deliberation_policy_unavailable",
    };
  }
  const policy = payload.policy as DeliberationPolicy;
  const roleIds = policy.participants.map((participant) => participant.roleId);
  if (
    !validateSchema("deliberationPolicy", policy).valid ||
    policy.projectId !== input.projectId ||
    policy.policyId !== payload.policyId ||
    policy.maxRounds !== payload.maxRounds ||
    deliberationPolicyHash(policy) !== payload.policyHash ||
    JSON.stringify(roleIds) !== JSON.stringify(payload.participantRoleIds)
  ) {
    return {
      status: "invalid",
      policy: null,
      startedEventId: event.eventId,
      reasonCode: "deliberation_policy_event_invalid",
    };
  }
  return {
    status: "complete",
    policy: structuredClone(policy),
    startedEventId: event.eventId,
    reasonCode: null,
  };
}
