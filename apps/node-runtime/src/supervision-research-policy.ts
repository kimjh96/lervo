import {
  loadResearchSourcePolicy,
  prepareResearchInputs,
  readResearchSourceFile,
  researchContractHash,
} from "@lervo/roles";
import type { RoleProfile } from "@lervo/schemas";
import type { WorkResponsibilityV1 } from "@lervo/application-contract";

/** A stable source observation makes policy repair visible without turning elapsed time into new work. */
export async function observeSupervisionResearchPolicy(repositoryRoot: string, projectId: string) {
  try {
    const { policy, contentHash } = await loadResearchSourcePolicy(repositoryRoot, projectId);
    const sources = [];
    for (const path of policy.allowedPaths) {
      const source = await readResearchSourceFile(repositoryRoot, path, policy.maximumSourceBytes);
      sources.push({ path, contentHash: source.contentHash });
    }
    if ((await loadResearchSourcePolicy(repositoryRoot, projectId)).contentHash !== contentHash)
      throw new Error("The research policy changed during observation.");
    return { status: "available" as const, policy, contentHash, sources };
  } catch {
    return { status: "unavailable" as const, policy: null, contentHash: null, sources: [] };
  }
}

/** Readiness captures real permitted sources; the later managed run captures and binds its own inputs. */
export async function observeSupervisionResearchReadiness(input: {
  repositoryRoot: string;
  projectId: string;
  responsibility: WorkResponsibilityV1;
  role: RoleProfile;
  now(): string;
}) {
  try {
    const prepared = await prepareResearchInputs({
      ...input,
      researchQuestion: input.responsibility.taskPurpose,
      roleContractHash: input.responsibility.roleContractHash,
    });
    if (
      prepared.inputs.policy.allowedPaths.some(
        (path) =>
          !input.responsibility.expectedPaths.some(
            (root) => path === root || path.startsWith(`${root}/`),
          ),
      )
    )
      throw new Error("Research sources exceed the task's explicit read scope.");
    return {
      kind: "source_policy" as const,
      status: "passed" as const,
      evidenceHash: researchContractHash({
        inputHash: prepared.inputHash,
        policyContentHash: prepared.policyContentHash,
      }),
    };
  } catch {
    return { kind: "source_policy" as const, status: "unobserved" as const, evidenceHash: null };
  }
}
