import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { ArtifactStore } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { readSupervisionHandoffArtifact } from "./supervision-handoff-artifact.js";

export async function readCanonicalSupervisionHandoff(input: {
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  binding: NodeSupervisionBinding;
  artifacts: ArtifactStore;
  plan: OperatingActionPlanV1;
}) {
  const { source, plan, binding } = input;
  const basis = await readSupervisionHandoffArtifact(input.artifacts, plan);
  const party =
    basis.effect.kind === "work.scoped_handoff" ? basis.offer.source : basis.offer.recipient;
  const snapshotHash =
    basis.effect.kind === "work.scoped_handoff"
      ? basis.offer.sourceSnapshotHash
      : basis.offer.recipientSnapshotHash;
  const owner = source.agents.find((agent) => agent.agentId === plan.ownerAgentId);
  if (
    ["projectId", "teamId", "workstreamId", "ownerAgentId", "mandateHash"].some(
      (key) => party[key as keyof typeof party] !== plan[key as keyof OperatingActionPlanV1],
    ) ||
    party.workstreamRevision !== source.workstream.revision ||
    source.workstream.status !== "active" ||
    source.workstreamHash !== snapshotHash ||
    binding.ownerAgentId !== plan.ownerAgentId ||
    binding.mandateHash !== plan.mandateHash ||
    binding.supervisionId !== plan.supervisionId ||
    binding.workstreamId !== plan.workstreamId ||
    owner?.status !== "active" ||
    owner.roleId !== plan.roleId ||
    (owner.provider !== "any" && owner.provider !== plan.provider) ||
    operatingContractHash(basis.effect) !== plan.responsibilityArtifactHash
  )
    throw new Error("The handoff differs from its exact active local owner and workstream.");
  return basis;
}
