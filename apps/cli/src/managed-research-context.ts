import { canonicalJson } from "@lervo/event-contract";
import type { DocumentRegistry, RoleProfile } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  prepareResearchInputs,
  researchBriefInstructions,
  researchSourcePolicyPath,
  researchContractHash,
} from "@lervo/roles";

/** Supplies explicit research inputs and required E3 source documents without editing user-owned sources. */
export async function prepareManagedResearchContext(input: {
  repositoryRoot: string;
  projectId: string;
  role: RoleProfile;
  roleContractHash: string;
  researchQuestion: string;
  expectedPaths: readonly string[];
  registry: DocumentRegistry;
  artifacts: ArtifactStore;
  now(): string;
}) {
  if (!input.role.contextPolicy.requiredDocumentRuleIds.includes("research.source-policy"))
    return null;
  const prepared = await prepareResearchInputs(input);
  if (
    prepared.inputs.policy.allowedPaths.some(
      (path) => !input.expectedPaths.some((root) => path === root || path.startsWith(`${root}/`)),
    )
  )
    throw new Error("Research sources exceed the explicit task paths.");
  const stored = await input.artifacts.put(canonicalJson(prepared.inputs));
  if (stored.contentHash !== prepared.inputHash)
    throw new Error("The research input CAS hash changed.");
  const registry = structuredClone(input.registry);
  const sources = [
    { path: researchSourcePolicyPath, contentHash: prepared.policyContentHash },
    ...prepared.inputs.sources,
  ];
  const ids: string[] = [];
  for (const source of sources) {
    const id = `doc_research_${researchContractHash(source.path).slice(7, 31)}`;
    ids.push(id);
    const prior = registry.documents[id];
    if (prior !== undefined)
      throw new Error(
        "The research observation identity conflicts with an existing repository document.",
      );
    registry.documents[id] = {
      path: source.path,
      kind: "observed",
      responsibleParty: { kind: "user", id: "repository-source-policy" },
      connectedPaths: [...input.expectedPaths],
      verifiedRevision: source.contentHash,
      verifiedAt: input.now(),
      reviewIntervalDays: 1,
      ownership: { mode: "user" },
    };
  }
  return {
    registry,
    documentRules: { "research.source-policy": ids },
    instructions: researchBriefInstructions(prepared.inputs),
    inputs: prepared.inputs,
    binding: {
      contractId: "research.inputs.v1",
      roleContractHash: input.roleContractHash,
      inputArtifactHash: prepared.inputHash,
    },
  };
}
