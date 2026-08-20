import type { ProviderRuntimeInspection } from "@lervo/adapter-contract";
import { inspectClaudeRuntime } from "@lervo/adapter-claude";
import { inspectCodexRuntime } from "@lervo/adapter-codex";
import type { DoctorInspection, DoctorScope } from "@lervo/diagnostics";

import { inspectDoctorDocuments } from "./doctor-document-inspection.js";
import { inspectDoctorProvider } from "./doctor-provider-inspection.js";
import { inspectDoctorSearch } from "./doctor-search-inspection.js";
import { inspectDoctorSkills } from "./doctor-skill-inspection.js";
import { searchCandidateRegistry } from "./search-candidate-registry.js";

export interface DoctorEnvironmentOptions {
  userSkillRoot?: string;
  inspectCodex?: () => Promise<ProviderRuntimeInspection>;
  inspectClaude?: () => Promise<ProviderRuntimeInspection>;
  observedAt?: Date;
}

export async function inspectDoctorEnvironment(
  input: { repositoryRoot: string; projectId: string; scope?: DoctorScope },
  options: DoctorEnvironmentOptions = {},
): Promise<DoctorInspection[]> {
  const searchInput = {
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    registry: searchCandidateRegistry,
    observedAt: options.observedAt ?? new Date(),
  };
  if (input.scope === "search") return inspectDoctorSearch(searchInput);
  const [documents, skills, codex, claude, search] = await Promise.all([
    inspectDoctorDocuments(input.repositoryRoot),
    inspectDoctorSkills({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      ...(options.userSkillRoot === undefined ? {} : { userSkillRoot: options.userSkillRoot }),
    }),
    (options.inspectCodex ?? inspectCodexRuntime)(),
    (options.inspectClaude ?? inspectClaudeRuntime)(),
    inspectDoctorSearch(searchInput),
  ]);
  return [
    ...documents,
    ...skills,
    inspectDoctorProvider(codex),
    inspectDoctorProvider(claude),
    ...search,
  ];
}
