import { prepareCanonicalSupervisionReadiness } from "./supervision-canonical-readiness.js";
import { inspectSupervisionKnowledgeReadiness } from "./supervision-knowledge-readiness.js";
import { observeFinalSupervisionReadiness } from "./supervision-final-readiness.js";
import { bindNodeSupervisionReadiness } from "./supervision-readiness.js";
import { NodeSupervisionError } from "./supervision-authority.js";
import { operatingAggregateBudgetRequired, operatingContractHash } from "@lervo/work-controller";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import type { NodeSupervisionSession } from "./supervision-session.js";
import type {
  NodeOutcomeSupervisionPorts,
  NodeCanonicalOutcomeSupervisionPorts,
  NodeNativeOutcomeSupervisionPorts,
} from "./outcome-supervision-runtime.js";
import type {
  OperatingActionPlanV1,
  OperatingAdmissionSnapshotV1,
} from "@lervo/application-contract";
import { openReadOnlyProjectStorage } from "@lervo/project-storage";

interface DispatchReadinessInput {
  repositoryRoot: string;
  plan: OperatingActionPlanV1;
  session: NodeSupervisionSession;
  ports:
    | NodeOutcomeSupervisionPorts
    | NodeCanonicalOutcomeSupervisionPorts
    | NodeNativeOutcomeSupervisionPorts;
  configuration: NodeRuntimeReadinessConfiguration | undefined;
  sourceBinding: { authorityDigest: string; taskDigest: string; combined: string } | null;
  expectedKnowledgeSnapshotId?: string;
}

/** Composes actual context, runtime, verification, login and repository observations for dispatch. */
export async function readNodeDispatchReadiness(input: DispatchReadinessInput) {
  const observed = await readDispatchObservations(input, async () => null);
  return { readiness: observed.readiness, sourceSnapshotId: observed.sourceSnapshotId };
}

/** Final independent reads share one observation window and must both settle before effects. */
export function readNodeDispatchPreflight(
  input: DispatchReadinessInput & {
    expectedKnowledgeSnapshotId: string;
    readAdmission(): Promise<OperatingAdmissionSnapshotV1>;
  },
) {
  return readDispatchObservations(input, input.readAdmission);
}

async function readDispatchObservations<Admission>(
  input: DispatchReadinessInput,
  readAdmission: () => Promise<Admission>,
) {
  const { plan, configuration } = input;
  const workspaceEvidenceStorage = await openReadOnlyProjectStorage(input.repositoryRoot);
  try {
    const supplied =
      "readWorkerReadiness" in input.ports ? await input.ports.readWorkerReadiness(plan) : null;
    const [knowledge, installation] = await Promise.all([
      inspectSupervisionKnowledgeReadiness({
        repositoryRoot: input.repositoryRoot,
        projectId: plan.projectId,
        requiredPaths: plan.expectedPaths,
        now: input.ports.now,
      }),
      supplied === null ? input.session.readMandate() : Promise.resolve(null),
    ]);
    if (
      input.expectedKnowledgeSnapshotId !== undefined &&
      knowledge.sourceSnapshotId !== input.expectedKnowledgeSnapshotId
    )
      throw new NodeSupervisionError("supervision_knowledge_snapshot_changed");
    if (
      installation !== null &&
      (installation.mandateHash !== plan.mandateHash ||
        operatingContractHash(installation.mandate) !== plan.mandateHash)
    )
      throw new NodeSupervisionError("supervision_binding_invalid");
    let taskReadiness = supplied;
    if (taskReadiness === null) {
      if (installation === null) throw new NodeSupervisionError("supervision_binding_invalid");
      const taskSource = await input.session.readTaskResponsibility(plan);
      const taskAdmission = await input.session.readTaskAdmission(plan);
      taskReadiness = await prepareCanonicalSupervisionReadiness({
        repositoryRoot: input.repositoryRoot,
        plan,
        ...taskSource,
        admission: taskAdmission,
        aggregateBudgetRequired: operatingAggregateBudgetRequired(installation.mandate),
        configuration,
        now: input.ports.now,
        workspaceEvidenceStorage,
      });
      const { observedAt: _preparedAt, ...preparedAdmission } = taskAdmission;
      const { observedAt: _confirmedAt, ...confirmedAdmission } =
        await input.session.readTaskAdmission(plan);
      if (operatingContractHash(confirmedAdmission) !== operatingContractHash(preparedAdmission))
        throw new NodeSupervisionError("supervision_readiness_changed");
    }
    const readiness = bindNodeSupervisionReadiness({
      plan,
      readiness: taskReadiness,
      sourceBinding: input.sourceBinding,
    });
    const finishReadiness = async () => {
      const recorded = await input.session.readResponsibility(
        readiness.responsibility.assignmentId,
      );
      if (recorded === null || recorded.responsibilityHash !== plan.responsibilityArtifactHash)
        throw new NodeSupervisionError("supervision_readiness_changed");
      readiness.responsibility = recorded.responsibility;
      return await observeFinalSupervisionReadiness({
        repositoryRoot: input.repositoryRoot,
        projectId: plan.projectId,
        plan,
        readiness,
        configuration,
        knowledge,
        now: input.ports.now,
        workspaceEvidenceStorage,
      });
    };
    const [observed, admission] = await Promise.allSettled([finishReadiness(), readAdmission()]);
    if (observed.status === "rejected") throw observed.reason;
    if (admission.status === "rejected") throw admission.reason;
    return {
      readiness: observed.value,
      admission: admission.value,
      sourceSnapshotId: knowledge.sourceSnapshotId,
    };
  } finally {
    await workspaceEvidenceStorage.close();
  }
}
