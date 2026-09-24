import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { OutcomeSupervisionPorts } from "@lervo/orchestrator";
import type { ProjectStorage } from "@lervo/project-storage";
import { NodeSupervisionError } from "./supervision-authority.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import { observeSupervisionKnowledgeReadiness } from "./supervision-knowledge-readiness.js";
import { observeSupervisionLoginReadiness } from "./supervision-login-readiness.js";
import { observeSupervisionRepositoryReadiness } from "./supervision-repository-readiness.js";
import { observeSupervisionRuntimeReadiness } from "./supervision-runtime-readiness.js";
import { observeSupervisionVerificationReadiness } from "./supervision-verification-readiness.js";

type Readiness = Awaited<ReturnType<OutcomeSupervisionPorts["readWorkerReadiness"]>>;
type KnowledgeInspection = Awaited<
  ReturnType<
    typeof import("./supervision-knowledge-readiness.js").inspectSupervisionKnowledgeReadiness
  >
>;

/** Independent final probes share one short observation window without sharing mutable checks. */
export async function observeFinalSupervisionReadiness(input: {
  repositoryRoot: string;
  projectId: string;
  plan: OperatingActionPlanV1;
  readiness: Readiness;
  configuration: NodeRuntimeReadinessConfiguration | undefined;
  knowledge: KnowledgeInspection;
  now(): string;
  workspaceEvidenceStorage: ProjectStorage;
  canonicalPrepared: boolean;
}): Promise<Readiness> {
  const { plan, readiness, configuration, now } = input;
  const finalStartedAt = now();
  const results = await Promise.allSettled([
    observeSupervisionVerificationReadiness({
      repositoryRoot: input.repositoryRoot,
      readiness,
      configuration,
      now,
    }),
    (async () =>
      observeSupervisionRuntimeReadiness({
        plan,
        readiness: await observeSupervisionLoginReadiness({ plan, readiness, configuration, now }),
        configuration,
        now,
      }))(),
    observeSupervisionKnowledgeReadiness({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      requiredPaths: plan.expectedPaths,
      readiness,
      preparedInspection: input.knowledge,
      now,
    }),
    observeSupervisionRepositoryReadiness({
      repositoryRoot: input.repositoryRoot,
      plan,
      readiness,
      now,
      workspaceEvidenceStorage: input.workspaceEvidenceStorage,
    }),
  ]);
  const [verification, runtime, knowledge, repository] = results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  if (!verification || !runtime || !knowledge || !repository)
    throw new NodeSupervisionError("supervision_readiness_changed");
  const finalElapsed = Date.parse(now()) - Date.parse(finalStartedAt);
  if (!Number.isFinite(finalElapsed) || finalElapsed < 0 || finalElapsed > 5000)
    throw new NodeSupervisionError("supervision_readiness_stale");
  if (input.canonicalPrepared && Date.parse(readiness.observation.validUntil) < Date.parse(now()))
    throw new NodeSupervisionError("supervision_readiness_stale");
  const owner = (kind: Readiness["observation"]["checks"][number]["kind"]): Readiness => {
    if (kind === "verification") return verification;
    if (kind === "provider" || kind === "tools" || kind === "cli") return runtime;
    if (kind === "knowledge") return knowledge;
    if (["read_scope", "write_scope", "lease", "ancestry", "workspace"].includes(kind))
      return repository;
    return readiness;
  };
  return {
    ...readiness,
    observation: {
      ...readiness.observation,
      // Canonical context is still within its own validity bound. The final five-second
      // witness dates the fresh mutable probes, not the earlier context preparation.
      observedAt: input.canonicalPrepared ? finalStartedAt : readiness.observation.observedAt,
      validUntil:
        Date.parse(knowledge.observation.validUntil) < Date.parse(readiness.observation.validUntil)
          ? knowledge.observation.validUntil
          : readiness.observation.validUntil,
      checks: readiness.observation.checks.map((check) => {
        const observed = owner(check.kind).observation.checks.find(
          (candidate) => candidate.kind === check.kind,
        );
        if (observed === undefined) throw new NodeSupervisionError("supervision_readiness_changed");
        return observed;
      }),
    },
  };
}
