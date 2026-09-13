import {
  createRoleEvaluationResult,
  researchContractHash,
  type RoleDefinition,
} from "@lervo/roles";
import { managedExecutionIdentity } from "@lervo/work-controller";
import type { OwnerReasoningContext } from "./supervision-reasoning-context.js";

/** Binds independent semantic verdicts and deterministic originals into the existing role evaluation contract. */
export function prepareSupervisionResearchEvaluation(input: {
  facts: OwnerReasoningContext["facts"];
  assignmentId: string;
  details: Record<string, unknown>;
  projectId: string;
  reasoningPlanHash: string;
  reasoningResultHash: string;
  content: string;
  evaluatedAt: string;
}) {
  const assignment = input.facts.assignments.find(
    (item) => item.assignmentId === input.assignmentId,
  );
  const role = input.facts.roles.find((item) => item.roleId === assignment?.roleId);
  if (!role?.profile.contextPolicy.requiredDocumentRuleIds.includes("research.source-policy")) {
    if (Object.hasOwn(input.details, "researchChecks"))
      throw new Error("This role has no research evaluation contract.");
    return null;
  }
  const evidence = input.facts.researchEvidence.find(
    (item) => item.assignmentId === input.assignmentId,
  );
  const semantic = input.details.researchChecks as {
    checkId: string;
    status: "passed" | "failed";
  }[];
  const required = role.evaluation.checks.filter((item) => item.method === "separate_semantic");
  if (
    evidence === undefined ||
    evidence.inputs.roleContractHash !== role.contractHash ||
    input.facts.researchPolicy?.status !== "available" ||
    researchContractHash(input.facts.researchPolicy.policy) !== evidence.inputs.policyHash ||
    input.facts.researchPolicy.sources.some(
      (source) =>
        !evidence.inputs.sources.some(
          (original) =>
            original.path === source.path && original.contentHash === source.contentHash,
        ),
    ) ||
    !Array.isArray(semantic) ||
    semantic.length !== required.length ||
    new Set(semantic.map((item) => item.checkId)).size !== semantic.length ||
    semantic.some(
      (item) =>
        Object.keys(item).sort().join(",") !== "checkId,status" ||
        !["passed", "failed"].includes(item.status) ||
        !required.some((check) => check.checkId === item.checkId),
    )
  )
    throw new Error(
      "The independent research verdict differs from its exact role, source policy, or checks.",
    );
  const definition: RoleDefinition = { profile: role.profile, evaluation: role.evaluation };
  const coordinate = (hash: string) => ({ artifactId: `art_${hash.slice(7)}`, contentHash: hash });
  const evaluatorRunId = managedExecutionIdentity(input.projectId, input.reasoningPlanHash).runId;
  const result = createRoleEvaluationResult({
    definition,
    ...coordinate(evidence.resultContentHash),
    byteCount: Buffer.byteLength(input.content),
    mediaType: "text/markdown; charset=utf-8",
    producerRunId: evidence.producerRunId,
    evaluatedAt: input.evaluatedAt,
    observations: role.evaluation.checks.map((check) => {
      const independent = check.method === "separate_semantic";
      if (
        !independent &&
        !["research.artifact-schema", "research.source-traceability"].includes(check.checkId)
      )
        throw new Error("The research role requires an unsupported deterministic check.");
      return {
        checkId: check.checkId,
        status: independent
          ? semantic.find((item) => item.checkId === check.checkId)!.status
          : "passed",
        evaluatorId: independent ? "lervo.native-owner.research" : "lervo.research.verify.v1",
        evaluatorRunId: independent ? evaluatorRunId : null,
        evaluatorRoleId: independent
          ? input.facts.agents.find((agent) => agent.agentId === input.facts.mandate.ownerAgentId)!
              .roleId
          : null,
        evidence: (independent
          ? [evidence.inputArtifactHash, input.reasoningResultHash]
          : [evidence.verificationArtifactHash, evidence.reportArtifactHash]
        ).map(coordinate),
      };
    }),
  });
  return result;
}
