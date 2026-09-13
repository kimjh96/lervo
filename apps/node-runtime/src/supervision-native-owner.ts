import type { NodeSupervisionResultDeliveryConfiguration } from "./supervision-result-delivery.js";
import { materializeSuccessorClaim } from "./supervision-recovery-claim.js";
import type {
  AutomaticTopologyEffectV1,
  OperatingActionPlanV1,
  OutcomeSupervisionReportV1,
  SupervisedOwnerReasoningV1,
  SupervisedResponsibilityClaimV1,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import {
  operatingContractHash,
  supervisedOwnerReasoningFields,
  automaticTopologyEffectFields,
  supervisedResponsibilityClaimFields,
} from "@lervo/work-controller";
import { materializeNativeDispatch } from "./supervision-native-dispatch.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import {
  canonicalOwnerReasoningFacts,
  createOwnerReasoningContext,
} from "./supervision-reasoning-context.js";
import { readReusableOwnerDecision } from "./supervision-reasoning-history.js";
import { materializeNativeOwnerProposal } from "./supervision-native-plans.js";
import type { NodeOwnerReasoningConfiguration } from "./supervision-reasoning-effects.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";

/** Uses durable native judgement, then proposes separate canonically admitted business effects. */
export class NativeSupervisionOwner {
  private readonly binding: NodeSupervisionBinding;
  private readonly configuration: NodeOwnerReasoningConfiguration;
  private readonly readiness: NodeRuntimeReadinessConfiguration;
  private readonly publicationOrigin:
    NodeSupervisionResultDeliveryConfiguration["origin"] | undefined;
  constructor(
    private readonly root: string,
    binding: NodeSupervisionBinding,
    configuration: NodeOwnerReasoningConfiguration,
    readiness: NodeRuntimeReadinessConfiguration,
    private readonly now: () => string,
    publicationOrigin?: NodeSupervisionResultDeliveryConfiguration["origin"],
  ) {
    this.binding = structuredClone(binding);
    this.configuration = structuredClone(configuration);
    this.readiness = structuredClone(readiness);
    this.publicationOrigin =
      publicationOrigin === undefined ? undefined : structuredClone(publicationOrigin);
  }
  async propose(report: OutcomeSupervisionReportV1): Promise<OperatingActionPlanV1 | null> {
    if (report.nextAction === null || report.nextAction === "reconcile_cancellation") return null;
    const storage = await openProjectStorage(this.root);
    try {
      const source = await new SupervisionTaskSource(storage, this.binding, this.now).read();
      const authority = await observeNodeSupervisionAuthority(storage, this.binding, this.now);
      if (
        operatingContractHash({
          authorityDigest: authority.source.sourceRevisionDigest,
          taskDigest: source.sourceRevisionDigest,
        }) !== report.sourceRevisionDigest
      )
        throw new Error("The native owner planning source changed.");
      const { facts, basisHash } = await canonicalOwnerReasoningFacts(
        storage,
        this.binding,
        source,
        this.now,
      );
      const publicationOrigin = this.publicationOrigin ?? facts.boundRequest?.origin ?? undefined;
      if (report.nextAction === "publish_result" && publicationOrigin === undefined) return null;
      const owner = facts.agents.find((agent) => agent.agentId === this.binding.ownerAgentId)!;
      const base: OperatingActionPlanV1 = {
        schemaVersion: 1,
        ...this.binding,
        projectId: storage.manifest.projectId,
        teamId: authority.source.teamId,
        sourceRevisionDigest: report.sourceRevisionDigest,
        graphHash: source.graph.graphHash,
        causationEventIds: [...report.causationEventIds],
        actionKind: "execute_as_owner",
        effectContract: "work.owner_reasoning.v1",
        effectHash: operatingContractHash(null),
        rationaleArtifactHash: operatingContractHash(null),
        responsibilityArtifactHash: basisHash,
        roleId: owner.roleId,
        requiredCapabilities: [],
        expectedPaths: [],
        provider: this.configuration.provider,
        addedWorkers: 0,
        addedAssignments: 0,
        concurrentAttempts: 0,
        attemptNumber: 1,
        reservedTokens: 1,
        deadline: new Date(
          Math.min(Date.parse(this.now()) + 120_000, Date.parse(facts.mandate.expiresAt)),
        ).toISOString(),
      };
      if (
        report.nextAction === "dispatch" &&
        source.assignments.some(
          (assignment) =>
            report.assignmentIds.includes(assignment.assignmentId) &&
            assignment.lease !== null &&
            Date.parse(assignment.lease.expiresAt) > Date.parse(this.now()),
        )
      )
        return await materializeNativeDispatch({
          storage,
          source,
          base,
          assignmentIds: report.assignmentIds,
          readiness: this.readiness,
          reservedTokens: this.configuration.reservedTokens,
          now: this.now,
        });
      if (report.reasonCode === "responsibility_installation_required") {
        const recovery = await materializeSuccessorClaim({
          storage,
          source,
          base,
          assignmentIds: report.assignmentIds,
          now: this.now,
        });
        if (recovery !== null) return recovery;
        const claim = await this.automaticClaim(storage, source, base, report.assignmentIds);
        if (claim !== null) return claim;
      }
      const previous = await readReusableOwnerDecision({
        storage,
        binding: this.binding,
        source,
        basisHash,
        report,
        now: this.now,
      });
      if (previous.decision !== null)
        return await materializeNativeOwnerProposal({
          storage,
          facts,
          decision: previous.decision,
          base,
          reasoningPlanHash: previous.reasoningPlanHash!,
          resultArtifactHash: previous.resultArtifactHash!,
          readiness: this.readiness,
          ...(publicationOrigin === undefined ? {} : { publicationOrigin }),
          now: this.now,
        });
      if (
        previous.reason === "reasoning_effect_unresolved" ||
        previous.history.length >= Math.min(3, facts.mandate.maximumAttemptsPerAssignment)
      )
        return null;
      const context = await createOwnerReasoningContext({
        storage,
        binding: this.binding,
        source,
        report,
        expectedPaths: [...facts.mandate.pathRoots],
        now: this.now,
      });
      const effect: SupervisedOwnerReasoningV1 = {
        schemaVersion: 1,
        kind: "work.owner_reasoning",
        basisHash,
        contextArtifactHash: context.artifact.contentHash,
        roleId: owner.roleId,
        roleVersion: owner.roleVersion,
        roleContractHash: owner.roleContractHash,
        provider: this.configuration.provider,
        requestedModel: this.configuration.model ?? null,
        reservedTokens: this.configuration.reservedTokens,
        attemptNumber: previous.history.length + 1,
        deadline: base.deadline,
      };
      await storage.artifacts.put(canonicalJson(effect));
      const rationale = await storage.artifacts.put(
        canonicalJson(
          `Read canonical goal and staff evidence before ${report.nextAction}; this model call grants no business effect.`,
        ),
      );
      return {
        ...base,
        ...supervisedOwnerReasoningFields(effect),
        rationaleArtifactHash: rationale.contentHash,
      };
    } finally {
      await storage.close();
    }
  }

  private async automaticClaim(
    storage: ProjectStorage,
    source: Awaited<ReturnType<SupervisionTaskSource["read"]>>,
    base: OperatingActionPlanV1,
    ids: string[],
  ) {
    const assignment = source.assignments.find(
      (item) =>
        ids.includes(item.assignmentId) &&
        item.status === "blocked" &&
        item.revision === 1 &&
        item.lease === null &&
        item.topology?.policyReview !== undefined,
    );
    if (assignment === undefined) return null;
    const decision = source.events.find(
      (event) =>
        event.type === "work.supervision.decision.recorded" &&
        event.payload.decisionId === assignment.topology!.policyReview!.decisionId,
    );
    if (decision === undefined)
      throw new Error("The automatic assignment has no original policy decision.");
    const originalPlan = (await readSupervisionJsonArtifact(
      storage.artifacts,
      String(decision.payload.planArtifactHash),
    )) as OperatingActionPlanV1;
    await readAdmittedControlDecision(storage, originalPlan);
    const topology = (await readSupervisionJsonArtifact(
      storage.artifacts,
      originalPlan.effectHash,
    )) as AutomaticTopologyEffectV1;
    const fields = automaticTopologyEffectFields(topology);
    if (
      Object.entries(fields).some(
        ([key, value]) =>
          operatingContractHash(value) !==
          operatingContractHash(originalPlan[key as keyof OperatingActionPlanV1]),
      ) ||
      topology.responsibility.assignmentId !== assignment.assignmentId ||
      topology.topology.planId !== assignment.topology!.planId
    )
      throw new Error("The automatic responsibility differs from its original allocation.");
    if (Date.parse(topology.responsibility.startDeadline) <= Date.parse(this.now())) return null;
    const rationale = await storage.artifacts.put(
      canonicalJson(
        `Acquire the exact responsibility from admitted allocation ${decision.payload.planHash}; provider dispatch remains separate.`,
      ),
    );
    const effect: SupervisedResponsibilityClaimV1 = {
      schemaVersion: 1,
      kind: "work.responsibility_claim",
      responsibility: topology.responsibility,
      expectedAssignmentHash: operatingContractHash(assignment),
      provider: this.configuration.provider,
      leaseDurationMs: supervisionClaimDuration(topology.responsibility, this.now()),
      rationaleArtifactHash: rationale.contentHash,
    };
    await storage.artifacts.put(canonicalJson(effect));
    return { ...base, ...supervisedResponsibilityClaimFields(effect) };
  }
}
import { supervisionClaimDuration } from "./supervision-claim-duration.js";
