import type {
  EventEnvelope,
  ProductActivityActionClass,
  ProductActivityItemV1,
} from "@lervo/schemas";

const repositoryReadTypes = new Set<EventEnvelope["type"]>([
  "context.recommended",
  "context.selected",
  "document.loaded",
  "context.injected",
  "adapter.result.captured",
  "context.referenced",
  "context.invalidated",
]);

const repositoryEditTypes = new Set<EventEnvelope["type"]>([
  "file.changed",
  "knowledge.candidate.created",
  "knowledge.candidate.reviewed",
  "knowledge.reconciliation.reviewed",
  "knowledge.verified",
  "knowledge.stale.detected",
  "knowledge.materialization.applied",
  "document.stale.detected",
  "document.migration.applied",
  "state.pruned",
]);

const commandTypes = new Set<EventEnvelope["type"]>([
  "tool.called",
  "command.executed",
  "capability.requested",
  "capability.activated",
  "capability.recommended",
  "capability.selected",
  "capability.loaded",
  "capability.invoked",
  "capability.completed",
  "skill.resolved",
  "skill.invoked",
  "skill.completed",
  "terminal.integration.applied",
  "terminal.context.prepared",
  "terminal.turn.declared",
  "terminal.reference.observed",
  "terminal.turn.observed",
]);

const approvalTypes = new Set<EventEnvelope["type"]>([
  "capability.decided",
  "work.supervision.decision.recorded",
  "work.supervision.decision.superseded",
  "work.supervision.review.recorded",
]);

function actorCoordinate(event: EventEnvelope): string {
  if (event.actor.kind === "system") return "system:lervo";
  if (event.actor.kind === "provider") return `provider:${event.actor.provider}`;
  return `run:${event.runId}/actor:${event.actor.kind}`;
}

function actionClass(type: EventEnvelope["type"]): ProductActivityActionClass {
  if (type === "conversation.repository_work.completed") return "delivery";
  if (repositoryReadTypes.has(type)) return "repository_read";
  if (repositoryEditTypes.has(type)) return "repository_edit";
  if (commandTypes.has(type)) return "command";
  if (type.startsWith("verification.")) return "verification";
  if (approvalTypes.has(type)) return "approval";
  if (type.includes("handoff")) return "handoff";
  if (type.includes("delivery.") || type === "context.published") return "delivery";
  if (type.endsWith(".failed")) return "failure";
  return "lifecycle";
}

function outcome(type: EventEnvelope["type"]): ProductActivityItemV1["outcome"] {
  if (type.endsWith(".failed")) {
    return type.includes("readiness") ? "blocked" : "failed";
  }
  if (type.endsWith(".cancelled")) return "cancelled";
  if (type.endsWith(".requested") || type.endsWith(".started") || type.endsWith(".reserved")) {
    return "started";
  }
  return "succeeded";
}

function salience(
  type: EventEnvelope["type"],
  classification: ProductActivityActionClass,
): ProductActivityItemV1["salience"] {
  if (type.endsWith(".failed") || type.endsWith(".cancelled")) return "critical";
  if (["approval", "verification", "handoff", "delivery"].includes(classification)) return "high";
  if (classification === "repository_read") return "low";
  return "normal";
}

function privacyClass(type: EventEnvelope["type"]): ProductActivityItemV1["privacyClass"] {
  if (
    type.startsWith("terminal.") ||
    type === "resource.usage.recorded" ||
    type === "provider.process.observed"
  ) {
    return "sensitive";
  }
  return "ordinary";
}

export function activityCursorFromEventHash(eventHash: string): string {
  return `pac_${eventHash.slice("sha256:".length, "sha256:".length + 24)}`;
}

export function projectActivityItem(event: EventEnvelope): ProductActivityItemV1 {
  const classification = actionClass(event.type);
  const hashSuffix = event.eventHash.slice("sha256:".length, "sha256:".length + 24);
  return {
    activityId: `pact_${hashSuffix}`,
    observedAt: event.occurredAt,
    actor: {
      kind: event.actor.kind === "user" ? "human" : event.actor.kind,
      coordinate: actorCoordinate(event),
    },
    actionClass: classification,
    object: { kind: event.type, coordinate: `event:${event.eventId}` },
    outcome: outcome(event.type),
    salience: salience(event.type, classification),
    privacyClass: privacyClass(event.type),
    sourceCoordinates: [`event:${event.eventId}`],
    projectionStatus: "complete",
  };
}
