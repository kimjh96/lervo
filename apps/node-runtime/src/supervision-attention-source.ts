import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { canonicalOwnerReasoningFacts } from "./supervision-reasoning-context.js";
import { readSupervisionAttentionArtifact } from "./supervision-attention-artifact.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { inspectSupervisionAttentionReceipt } from "./supervision-attention-receipt.js";
import { retainsExhaustedRecoveryAttention } from "./supervision-attention-continuity.js";
import type { OperatingMandate } from "@lervo/application-contract";
import { validateSchema, type WorkstreamSnapshot } from "@lervo/schemas";
import { assertOperatingMandate, operatingContractHash } from "@lervo/work-controller";

export async function readCanonicalSupervisionAttention(input: {
  storage: ProjectStorage;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  now(): string;
}) {
  const basis = await readSupervisionAttentionArtifact(input.storage.artifacts, input.plan);
  const facts = await canonicalOwnerReasoningFacts(
    input.storage,
    input.binding,
    input.source,
    input.now,
  );
  const owner = input.source.agents.find((agent) => agent.agentId === input.plan.ownerAgentId);
  if (
    facts.basisHash !== basis.effect.basisHash ||
    owner?.status !== "active" ||
    owner.roleId !== input.plan.roleId ||
    (owner.provider !== "any" && owner.provider !== input.plan.provider) ||
    !["active", "completed"].includes(input.source.workstream.status) ||
    input.plan.ownerAgentId !== input.binding.ownerAgentId ||
    input.plan.mandateHash !== input.binding.mandateHash
  )
    throw new Error(
      "The owner attention differs from its current semantic task basis or owner authority.",
    );
  return basis;
}

/**
 * When the earliest still-pending owner attention was recorded, or null when none is pending. The
 * principal proxy decides once this is older than the escalation bound (ADR-0561).
 */
export async function pendingSupervisionAttentionSince(
  input: Omit<Parameters<typeof readCanonicalSupervisionAttention>[0], "plan">,
): Promise<string | null> {
  const events = input.source.supervisionEvents.filter(
    (event) => event.type === "work.supervision.escalation.recorded",
  );
  if (events.length === 0) return null;
  const facts = await canonicalOwnerReasoningFacts(
    input.storage,
    input.binding,
    input.source,
    input.now,
  );
  for (const event of events) {
    const plan = (await readSupervisionJsonArtifact(
      input.storage.artifacts,
      String(event.payload.decisionArtifactHash),
    )) as OperatingActionPlanV1;
    if (plan.effectContract !== "work.owner_attention.v1") continue;
    const receipt = await inspectSupervisionAttentionReceipt(input.storage, plan);
    if (receipt.status !== "confirmed" || receipt.eventIds[0] !== event.eventId)
      throw new Error("Pending owner attention has no exact admitted receipt.");
    const basis = await readSupervisionAttentionArtifact(input.storage.artifacts, plan);
    if (basis.effect.basisHash === facts.basisHash) return event.occurredAt;
    if (basis.effect.reasonCode !== "retry_budget_requires_resolution") continue;
    const previousInstallation = input.source.events.findLast(
      (candidate) =>
        candidate.type === "work.supervision.mandate.installed" &&
        candidate.seq < event.seq &&
        candidate.payload.mandateHash === plan.mandateHash &&
        candidate.payload.workstreamId === plan.workstreamId,
    );
    const previousWorkstreamEvent = input.source.events.findLast(
      (candidate) =>
        candidate.type === "workstream.snapshot.recorded" &&
        candidate.seq < event.seq &&
        candidate.payload.workstreamId === plan.workstreamId,
    );
    if (previousInstallation === undefined || previousWorkstreamEvent === undefined) continue;
    const [previousMandate, previousWorkstream] = await Promise.all([
      readSupervisionJsonArtifact(
        input.storage.artifacts,
        String(previousInstallation.payload.mandateArtifactHash),
      ) as Promise<OperatingMandate>,
      readSupervisionJsonArtifact(
        input.storage.artifacts,
        String(previousWorkstreamEvent.payload.snapshotContentHash),
      ) as Promise<WorkstreamSnapshot>,
    ]);
    assertOperatingMandate(previousMandate);
    if (
      operatingContractHash(previousMandate) !== plan.mandateHash ||
      !validateSchema("workstreamSnapshot", previousWorkstream).valid
    )
      throw new Error("The previous owner attention authority source is invalid.");
    if (
      retainsExhaustedRecoveryAttention({
        reasonCode: basis.effect.reasonCode,
        decisionId: String(event.payload.escalationId),
        previousMandate,
        currentMandate: facts.facts.mandate,
        previousWorkstream,
        currentWorkstream: input.source.workstream,
        interveningEvents: input.source.events.filter((candidate) => candidate.seq > event.seq),
        assignments: facts.facts.tasks.assignments,
      })
    )
      return event.occurredAt;
  }
  return null;
}

/** Snapshot fields for pending owner attention; the time lets the principal proxy apply its bound. */
export async function readPendingSupervisionAttention(
  input: Parameters<typeof pendingSupervisionAttentionSince>[0],
): Promise<{ attentionPending: boolean; attentionPendingSince: string | null }> {
  const since = await pendingSupervisionAttentionSince(input);
  return { attentionPending: since !== null, attentionPendingSince: since };
}
