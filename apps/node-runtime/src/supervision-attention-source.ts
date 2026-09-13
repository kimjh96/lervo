import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { canonicalOwnerReasoningFacts } from "./supervision-reasoning-context.js";
import { readSupervisionAttentionArtifact } from "./supervision-attention-artifact.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { inspectSupervisionAttentionReceipt } from "./supervision-attention-receipt.js";

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

export async function hasPendingSupervisionAttention(
  input: Omit<Parameters<typeof readCanonicalSupervisionAttention>[0], "plan">,
) {
  const events = input.source.supervisionEvents.filter(
    (event) => event.type === "work.supervision.escalation.recorded",
  );
  if (events.length === 0) return false;
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
    if (basis.effect.basisHash === facts.basisHash) return true;
  }
  return false;
}
