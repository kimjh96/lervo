import { observeSupervisionLoginReadiness } from "./supervision-login-readiness.js";
import { prepareCanonicalSupervisionReadiness } from "./supervision-canonical-readiness.js";
import { observeSupervisionVerificationReadiness } from "./supervision-verification-readiness.js";
import {
  inspectSupervisionKnowledgeReadiness,
  observeSupervisionKnowledgeReadiness,
} from "./supervision-knowledge-readiness.js";
import { observeSupervisionRuntimeReadiness } from "./supervision-runtime-readiness.js";
import { observeSupervisionRepositoryReadiness } from "./supervision-repository-readiness.js";
import { bindNodeSupervisionReadiness } from "./supervision-readiness.js";
import { NodeSupervisionError } from "./supervision-authority.js";
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
}

/** Composes actual context, runtime, verification, login and repository observations for dispatch. */
export async function readNodeDispatchReadiness(input: DispatchReadinessInput) {
  return (await readDispatchObservations(input, async () => null)).readiness;
}

/** Final independent reads share one observation window and must both settle before effects. */
export function readNodeDispatchPreflight(
  input: DispatchReadinessInput & { readAdmission(): Promise<OperatingAdmissionSnapshotV1> },
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
    const knowledge = await inspectSupervisionKnowledgeReadiness({
      repositoryRoot: input.repositoryRoot,
      projectId: plan.projectId,
      now: input.ports.now,
    });
    const taskReadiness =
      supplied !== null
        ? supplied
        : await prepareCanonicalSupervisionReadiness({
            repositoryRoot: input.repositoryRoot,
            plan,
            ...(await input.session.readTaskResponsibility(plan)),
            admission: await input.session.readTaskAdmission(plan),
            configuration,
            now: input.ports.now,
            workspaceEvidenceStorage,
          });
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
      const verified = await observeSupervisionVerificationReadiness({
        repositoryRoot: input.repositoryRoot,
        readiness,
        configuration,
        now: input.ports.now,
      });
      const loggedIn = await observeSupervisionLoginReadiness({
        plan,
        readiness: verified,
        configuration,
        now: input.ports.now,
      });
      return await observeSupervisionRepositoryReadiness({
        repositoryRoot: input.repositoryRoot,
        plan,
        readiness: await observeSupervisionRuntimeReadiness({
          plan,
          readiness: await observeSupervisionKnowledgeReadiness({
            repositoryRoot: input.repositoryRoot,
            projectId: plan.projectId,
            readiness: loggedIn,
            preparedInspection: knowledge,
            now: input.ports.now,
          }),
          configuration,
          now: input.ports.now,
        }),
        now: input.ports.now,
        workspaceEvidenceStorage,
      });
    };
    const [observed, admission] = await Promise.allSettled([finishReadiness(), readAdmission()]);
    if (observed.status === "rejected") throw observed.reason;
    if (admission.status === "rejected") throw admission.reason;
    return { readiness: observed.value, admission: admission.value };
  } finally {
    await workspaceEvidenceStorage.close();
  }
}
