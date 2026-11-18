import type { DoctorCheck, DoctorScope } from "./types.js";

const knowledgeCheckIds = ["event_chain"] as const satisfies readonly DoctorCheck["checkId"][];

const environmentCheckIds = {
  documents: ["document_registry", "document_sources"],
  skills: ["skill_packages", "skill_lock"],
  providers: ["provider_codex_runtime", "provider_claude_runtime"],
  search: ["search_engine_selection"],
} as const;

const allEnvironmentCheckIds = [
  ...environmentCheckIds.documents,
  ...environmentCheckIds.skills,
  ...environmentCheckIds.providers,
  ...environmentCheckIds.search,
] as const;

const checkIdsByScope = {
  all: [...knowledgeCheckIds, ...allEnvironmentCheckIds],
  knowledge: knowledgeCheckIds,
  ...environmentCheckIds,
} as const satisfies Record<DoctorScope, readonly DoctorCheck["checkId"][]>;

const environmentCheckIdsByScope = {
  all: allEnvironmentCheckIds,
  knowledge: [],
  ...environmentCheckIds,
} as const satisfies Record<DoctorScope, readonly DoctorCheck["checkId"][]>;

export function doctorCheckIdsForScope(scope: DoctorScope): readonly DoctorCheck["checkId"][] {
  return checkIdsByScope[scope];
}

export function environmentDoctorCheckIdsForScope(
  scope: DoctorScope,
): readonly DoctorCheck["checkId"][] {
  return environmentCheckIdsByScope[scope];
}
