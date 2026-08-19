import type { ProviderRuntimeInspection } from "@lervo/adapter-contract";
import { inspectClaudeRuntime } from "@lervo/adapter-claude";
import { inspectCodexRuntime } from "@lervo/adapter-codex";
import type { DoctorInspection } from "@lervo/diagnostics";

import { inspectDoctorDocuments } from "./doctor-document-inspection.js";
import { inspectDoctorProvider } from "./doctor-provider-inspection.js";
import { inspectDoctorSkills } from "./doctor-skill-inspection.js";

export interface DoctorEnvironmentOptions {
  userSkillRoot?: string;
  inspectCodex?: () => Promise<ProviderRuntimeInspection>;
  inspectClaude?: () => Promise<ProviderRuntimeInspection>;
}

export async function inspectDoctorEnvironment(
  input: { repositoryRoot: string; projectId: string },
  options: DoctorEnvironmentOptions = {},
): Promise<DoctorInspection[]> {
  const [documents, skills, codex, claude] = await Promise.all([
    inspectDoctorDocuments(input.repositoryRoot),
    inspectDoctorSkills({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      ...(options.userSkillRoot === undefined ? {} : { userSkillRoot: options.userSkillRoot }),
    }),
    (options.inspectCodex ?? inspectCodexRuntime)(),
    (options.inspectClaude ?? inspectClaudeRuntime)(),
  ]);
  return [
    ...documents,
    ...skills,
    inspectDoctorProvider(codex),
    inspectDoctorProvider(claude),
  ];
}
