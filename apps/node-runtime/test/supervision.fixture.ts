import type {
  OperatingActionPlanV1,
  OperatingActionKind,
  OutcomeSupervisionReportV1,
  OutcomeSupervisionSnapshotV1,
} from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { operatingContractHash, operatingEffectAdmissionHash } from "@lervo/work-controller";
import {
  createRepositoryMandatePlan,
  installRepositoryMandate,
} from "../../cli/src/mandate-installation.js";
import {
  installationFixture,
  hash,
  supervisionId,
} from "../../cli/test/mandate-installation.fixture.js";
import type { NodeOutcomeSupervisionPorts } from "../src/outcome-supervision-runtime.js";

export async function supervisionFixture(
  roots: string[],
  prepareRoot?: (root: string) => Promise<void>,
  roleId = "developer",
  actionKinds?: OperatingActionKind[],
  roleIds?: string[],
  projectId?: string,
  policy?: { capabilityCeiling: string[]; maximumAttemptTokens?: number },
) {
  const f = await installationFixture(roots, prepareRoot, roleId, projectId);
  if (actionKinds !== undefined) f.mandate.actionKinds = [...actionKinds];
  if (roleIds !== undefined) f.mandate.roleIds = [...roleIds];
  if (policy !== undefined) f.mandate.capabilityCeiling = [...policy.capabilityCeiling];
  if (policy?.maximumAttemptTokens !== undefined) {
    f.mandate.maximumAttemptTokens = policy.maximumAttemptTokens;
    f.mandate.maximumAggregateTokens = policy.maximumAttemptTokens * 5;
  }
  const installationPlan = await createRepositoryMandatePlan({
    ...f,
    supervisionId,
    reviewerId: f.mandate.appointingAuthorityId,
  });
  const installed = await installRepositoryMandate({
    root: f.root,
    plan: installationPlan,
    approval: installationPlan.approvalHash,
    reviewerId: f.mandate.appointingAuthorityId,
  });
  const binding = {
    supervisionId,
    workstreamId: installationPlan.source.workstreamId,
    ownerAgentId: f.owner.agentId,
    mandateHash: installed.mandateHash,
  };
  const observation: OutcomeSupervisionSnapshotV1 = {
    schemaVersion: 1,
    ...binding,
    projectId: f.owner.projectId,
    workstreamRevision: installationPlan.source.workstreamRevision,
    sourceRevisionDigest: hash(),
    causationEventIds: installationPlan.source.causationEventIds,
    evidenceStatus: "valid",
    workstreamStatus: "active",
    authorityStatus: "active",
    assignments: [],
    escalationCount: 0,
    pendingDecision: false,
    delivery: "not_attempted",
  };
  const planFor = (report: OutcomeSupervisionReportV1): OperatingActionPlanV1 => ({
    schemaVersion: 1,
    ...binding,
    projectId: f.owner.projectId,
    teamId: f.mandate.teamIds[0]!,
    sourceRevisionDigest: report.sourceRevisionDigest,
    graphHash: hash("b"),
    causationEventIds: report.causationEventIds,
    actionKind: "allocate_existing",
    effectContract: "fixture.allocation.v1",
    effectHash: hash("c"),
    rationaleArtifactHash: hash("d"),
    responsibilityArtifactHash: hash("e"),
    roleId: f.owner.roleId,
    requiredCapabilities: ["filesystem.read"],
    expectedPaths: ["src"],
    provider: "codex",
    addedWorkers: 0,
    addedAssignments: 1,
    concurrentAttempts: 0,
    attemptNumber: 1,
    reservedTokens: 100,
    deadline: new Date(Date.parse(f.mandate.issuedAt) + 1800_000).toISOString(),
  });
  const attention: string[][] = [];
  let proposals = 0;
  let effects = 0;
  let failEffect = false;
  const effectId = (plan: OperatingActionPlanV1) =>
    `evt_${operatingContractHash({ effect: plan.effectHash, source: plan.sourceRevisionDigest }).slice(7, 39)}`;
  const ports: NodeOutcomeSupervisionPorts = {
    now: () => new Date().toISOString(),
    readSnapshot: async () => structuredClone(observation),
    propose: async (report) => {
      proposals++;
      return planFor(report);
    },
    readAdmission: async (plan) => ({
      observedAt: new Date().toISOString(),
      sourceRevisionDigest: observation.sourceRevisionDigest,
      graphHash: plan.graphHash,
      installedMandateHash: null,
      installationReviewHash: null,
      revocationCoordinate: "untrusted.adapter.placeholder",
      revoked: false,
      ancestryValid: true,
      historyValid: true,
      activeWorkers: 1,
      activeAttempts: 0,
      assignmentCount: 0,
      observedAggregateTokens: 0,
      reservedAggregateTokens: 0,
      liveResponsibilityLease: false,
      resourceAdmission: "within",
      effectAdmissionHash: operatingEffectAdmissionHash(plan),
      effectMappings: [{ actionKind: "allocate_existing", contract: "fixture.allocation.v1" }],
    }),
    readWorkerReadiness: async () => {
      throw new Error("Allocation does not dispatch a provider.");
    },
    inspectEffect: async (plan) => {
      const storage = await openProjectStorage(f.root);
      try {
        return storage.events.get(effectId(plan)) === null
          ? { status: "uncertain" }
          : { status: "confirmed", eventIds: [effectId(plan)] };
      } finally {
        await storage.close();
      }
    },
    execute: async (plan, _review, fence) => {
      effects++;
      if (failEffect) throw new Error("fixture_uncertain_effect");
      const storage = await openProjectStorage(f.root);
      try {
        const event = fence.commit(
          () =>
            storage.events.append({
              eventId: effectId(plan),
              projectId: f.owner.projectId,
              runId: "run_node_supervision_fixture",
              sessionId: "ses_node_supervision_fixture",
              schemaVersion: 1,
              type: "run.requested",
              occurredAt: new Date().toISOString(),
              actor: { kind: "system" },
              policyVersion: hash(),
              payload: {},
            }).event,
        );
        return { eventIds: [event.eventId] };
      } finally {
        await storage.close();
      }
    },
    recordAttention: async (_report, reasons) => {
      attention.push(reasons);
    },
  };
  return {
    ...f,
    binding,
    installed,
    installationPlan,
    observation,
    ports,
    attention,
    counts: () => ({ proposals, effects }),
    failEffect: () => {
      failEffect = true;
    },
  };
}
