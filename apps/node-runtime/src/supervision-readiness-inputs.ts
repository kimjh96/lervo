import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { operatingContractHash } from "@lervo/work-controller";
import { inspectSupervisionKnowledgeReadiness } from "./supervision-knowledge-readiness.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";

/**
 * The Node inputs that decide a dispatch's worker readiness apart from its lease: the runtime
 * readiness configuration (applied at start) and the knowledge state of the plan's paths. A held
 * dispatch may be planned again only after one of them changes.
 */
export async function readSupervisionReadinessInputs(input: {
  repositoryRoot: string;
  plan: OperatingActionPlanV1;
  configuration: NodeRuntimeReadinessConfiguration | undefined;
  now(): string;
}): Promise<string | null> {
  const knowledge = await inspectSupervisionKnowledgeReadiness({
    repositoryRoot: input.repositoryRoot,
    projectId: input.plan.projectId,
    requiredPaths: input.plan.expectedPaths,
    now: input.now,
  });
  if (knowledge.sourceSnapshotId === null) return null;
  return operatingContractHash({
    configuration: input.configuration ?? null,
    knowledgeSourceSnapshotId: knowledge.sourceSnapshotId,
    knowledgeReady: knowledge.evidenceHash !== null,
  });
}
