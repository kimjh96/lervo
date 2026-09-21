import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { listAgents, listAssignments, registerAgent } from "@lervo/agent-workforce";
import { workforceProviderPolicyHash } from "@lervo/agent-organization";
import { openProjectStorage } from "@lervo/project-storage";
import { readBoundWorkstreamState } from "./supervision-workstream-state.js";
import { resolveRoleContract } from "@lervo/roles";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import { prepareSupervisionWorkforcePlan } from "./supervision-workforce-planning.js";
import { readCanonicalWorkerHire } from "./supervision-worker-hire-source.js";
import {
  inspectSupervisionHire,
  supervisionHireReceiptBasis,
} from "./supervision-worker-hire-receipt.js";
import {
  organizationCoordinate,
  projectOrganization,
} from "./agent-organization-event-mutation.js";

/** One scoped child and team membership, committed with canonical events under the parent owner fence. */
export class SupervisionWorkerHireEffects {
  private readonly binding: NodeSupervisionBinding;
  private readonly configuration: NodeRuntimeReadinessConfiguration;
  constructor(
    private readonly root: string,
    binding: NodeSupervisionBinding,
    configuration: NodeRuntimeReadinessConfiguration,
    private readonly now: () => string,
  ) {
    this.binding = structuredClone(binding);
    this.configuration = structuredClone(configuration);
  }
  async assertReady(plan: OperatingActionPlanV1) {
    const storage = await openProjectStorage(this.root);
    try {
      const source = await new SupervisionTaskSource(storage, this.binding, this.now).read(
        operatingDecisionId(plan),
      );
      const basis = await readCanonicalWorkerHire({ storage, source, plan, now: this.now });
      const planning = await prepareSupervisionWorkforcePlan({
        repositoryRoot: this.root,
        projectId: plan.projectId,
        workstreamId: plan.workstreamId,
        workstreamRevision: source.workstream.revision,
        ownerAgentId: plan.ownerAgentId,
        provider: basis.effect.provider,
        responsibility: basis.effect.requirement,
        configuration: this.configuration,
        now: this.now,
      });
      if (
        !["skill_gap", "capacity_gap"].includes(planning.selection.disposition) ||
        planning.workforce.sourceHash !== basis.workforce.sourceHash
      )
        throw new Error("The hiring environment or available workforce changed.");
    } finally {
      await storage.close();
    }
  }
  async inspect(plan: OperatingActionPlanV1) {
    const storage = await openProjectStorage(this.root);
    try {
      return await inspectSupervisionHire(storage, plan);
    } finally {
      await storage.close();
    }
  }
  async execute(plan: OperatingActionPlanV1, session: NodeSupervisionEffectSession) {
    await this.assertReady(plan);
    const storage = await openProjectStorage(this.root);
    try {
      const source = await new SupervisionTaskSource(storage, this.binding, this.now).read(
        operatingDecisionId(plan),
      );
      const basis = await readCanonicalWorkerHire({ storage, source, plan, now: this.now });
      const receipt = await supervisionHireReceiptBasis(storage, plan);
      const authority = await observeNodeSupervisionAuthority(storage, this.binding, this.now);
      const organization = projectOrganization(storage);
      const team = organization.team;
      if (
        team?.teamId !== plan.teamId ||
        authority.installation.revoked ||
        operatingContractHash({
          authorityDigest: authority.source.sourceRevisionDigest,
          taskDigest: source.sourceRevisionDigest,
        }) !== plan.sourceRevisionDigest
      )
        throw new Error("The hire owner, team or canonical source changed.");
      const allAssignments = await listAssignments(this.root);
      const occurredAt = this.now();
      const head = storage.events.latest()?.eventHash;
      await registerAgent({
        repositoryRoot: this.root,
        roleId: basis.role.roleId,
        provider: basis.effect.provider,
        displayName: basis.effect.displayName,
        parentAgentId: plan.ownerAgentId,
        responsibilityPaths: basis.effect.requirement.expectedPaths,
        now: new Date(occurredAt),
        recordEvent: async (event) => {
          const agents = await listAgents(this.root);
          const created = agents.find((item) => item.agentId === event.payload.agentId);
          const fresh = await observeNodeSupervisionAuthority(storage, this.binding, this.now);
          const currentRole = await resolveRoleContract(this.root, basis.role.roleId);
          const workstream = await readBoundWorkstreamState(storage, this.binding.workstreamId);
          const assignments = await listAssignments(this.root);
          if (
            created === undefined ||
            created.parentAgentId !== plan.ownerAgentId ||
            created.delegationDepth !== basis.parent.delegationDepth + 1 ||
            currentRole.contractHash !== basis.role.contractHash ||
            operatingContractHash(agents.filter((item) => item.agentId !== created.agentId)) !==
              basis.effect.expectedAgentsHash ||
            agents.filter((item) => item.status === "active").length >
              authority.installation.mandate.maximumWorkers ||
            operatingContractHash(assignments) !== operatingContractHash(allAssignments) ||
            workstream?.contentHash !== source.workstreamHash ||
            fresh.source.sourceRevisionDigest !== authority.source.sourceRevisionDigest ||
            fresh.installation.revoked
          )
            throw new Error("The hire source changed during child registration.");
          session.commit(() => {
            if (
              storage.events.latest()?.eventHash !== head ||
              Date.parse(this.now()) >=
                Math.min(
                  Date.parse(plan.deadline),
                  Date.parse(fresh.installation.mandate.expiresAt),
                )
            )
              throw new Error("The hire authority changed at event commit.");
            storage.events.transact((transaction) => {
              const envelope = {
                projectId: plan.projectId,
                runId: receipt.runId,
                sessionId: receipt.decision.sessionId,
                schemaVersion: 3 as const,
                occurredAt,
                actor: { kind: "system" as const },
                policyVersion: plan.mandateHash,
              };
              transaction.append({
                ...envelope,
                eventId: receipt.registeredEventId,
                type: "agent.registered",
                payload: event.payload,
              });
              transaction.append({
                ...envelope,
                eventId: receipt.membershipEventId,
                type: "organization.agent.membership.changed",
                payload: {
                  membershipId: organizationCoordinate("amem", {
                    organizationId: team.organizationId,
                    teamId: team.teamId,
                    agentId: created.agentId,
                  }),
                  organizationId: team.organizationId,
                  teamId: team.teamId,
                  projectId: plan.projectId,
                  agentId: created.agentId,
                  agentDisplayName: created.displayName,
                  agentDisplayNameSource: created.displayNameSource,
                  roleId: created.roleId,
                  roleVersion: created.roleVersion,
                  roleContractHash: created.roleContractHash,
                  roleProfileHash: created.roleProfileHash,
                  providerPolicyHash: workforceProviderPolicyHash(created.provider),
                  displayNameRevision: 1,
                  previousStatus: null,
                  status: "active",
                  revision: 1,
                  changedAt: occurredAt,
                },
              });
            });
          });
        },
      });
      const result = await inspectSupervisionHire(storage, plan);
      if (result.status !== "confirmed")
        throw new Error("The registered worker requires reconciliation.");
      return { eventIds: result.eventIds };
    } finally {
      await storage.close();
    }
  }
}
