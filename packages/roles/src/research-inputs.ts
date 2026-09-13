import type { RoleProfile } from "@lervo/schemas";
import {
  assertResearchInputs,
  researchContractHash,
  researchSourceUrl,
  type ResearchInputsV1,
} from "./research-contract.js";
import { loadResearchSourcePolicy, readResearchSourceFile } from "./research-source-files.js";

/** Captures the exact role inputs before execution; captured text is evidence, never new authority. */
export async function prepareResearchInputs(input: {
  repositoryRoot: string;
  projectId: string;
  researchQuestion: string;
  role: RoleProfile;
  roleContractHash: string;
  now(): string;
}) {
  if (
    input.role.outputContract.schemaRef !== "lervo-schema://roles/research-brief/v1" ||
    input.role.requiredInputs.length !== 2 ||
    input.role.requiredInputs.some(
      (item) =>
        !item.required ||
        item.sensitive ||
        item.schemaRef !==
          (
            {
              researchQuestion: "lervo-schema://roles/research-question/v1",
              sourceConstraints: "lervo-schema://roles/source-constraints/v1",
            } as Record<string, string>
          )[item.name],
    ) ||
    new Set(input.role.requiredInputs.map((item) => item.name)).size !== 2 ||
    !input.role.contextPolicy.requiredDocumentRuleIds.includes("research.source-policy")
  )
    throw new Error("The research role has unsupported input or output requirements.");
  const {
    policy,
    text: policyText,
    contentHash: policyContentHash,
  } = await loadResearchSourcePolicy(input.repositoryRoot, input.projectId);
  const sources = [];
  for (const [index, path] of policy.allowedPaths.entries()) {
    const source = await readResearchSourceFile(
      input.repositoryRoot,
      path,
      policy.maximumSourceBytes,
    );
    sources.push({
      sourceId: `S${index + 1}`,
      path,
      url: researchSourceUrl(input.projectId, path),
      retrievedAt: input.now(),
      ...source,
    });
  }
  const binding: ResearchInputsV1 = {
    schemaVersion: 1,
    kind: "research.inputs",
    researchQuestion: input.researchQuestion,
    sourceConstraints: { sourceKind: "repository", allowedPaths: policy.allowedPaths },
    policy,
    policyHash: researchContractHash(policy),
    roleContractHash: input.roleContractHash,
    sources,
  };
  assertResearchInputs(binding, input.now());
  const current = await loadResearchSourcePolicy(input.repositoryRoot, input.projectId);
  if (current.contentHash !== policyContentHash)
    throw new Error("The research policy changed during source capture.");
  return {
    inputs: binding,
    inputHash: researchContractHash(binding),
    policyText,
    policyContentHash,
  };
}
