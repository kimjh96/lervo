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
  const scope = input.scope ?? "all";
  const searchInput = {
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    registry: searchCandidateRegistry,
    observedAt: options.observedAt ?? new Date(),
  };
  const inspectSkills = () => inspectDoctorSkills({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    ...(options.userSkillRoot === undefined ? {} : { userSkillRoot: options.userSkillRoot }),
  });
  const inspectProviders = async (): Promise<DoctorInspection[]> => {
    const [codex, claude] = await Promise.all([
      (options.inspectCodex ?? inspectCodexRuntime)(),
      (options.inspectClaude ?? inspectClaudeRuntime)(),
    ]);
    return [inspectDoctorProvider(codex), inspectDoctorProvider(claude)];
  };
  if (scope === "knowledge") return [];
  if (scope === "documents") return inspectDoctorDocuments(input.repositoryRoot);
  if (scope === "skills") return inspectSkills();
  if (scope === "providers") return inspectProviders();
  if (scope === "search") return inspectDoctorSearch(searchInput);
  const [documents, skills, codex, claude, search] = await Promise.all([
    inspectDoctorDocuments(input.repositoryRoot),
    inspectSkills(),
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
