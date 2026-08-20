import type { DoctorScope } from "@lervo/diagnostics";

export const doctorScopeValues = [
  "all",
  "knowledge",
  "documents",
  "skills",
  "providers",
  "search",
] as const satisfies readonly DoctorScope[];

const scopeLabels = {
  all: "전체",
  knowledge: "지식",
  documents: "문서",
  skills: "스킬",
  providers: "에이전트 실행 환경",
  search: "검색",
} as const satisfies Record<DoctorScope, string>;

function isDoctorScope(value: string): value is DoctorScope {
  return doctorScopeValues.some((scope) => scope === value);
}

export function parseDoctorScope(value: string | undefined): DoctorScope {
  const candidate = value ?? "all";
  if (isDoctorScope(candidate)) return candidate;
  throw new TypeError(`지원하지 않는 doctor 범위입니다: ${candidate}`);
}

export function doctorScopeLabel(scope: DoctorScope): string {
  return scopeLabels[scope];
}

export function doctorScopeUsesProjectStorage(
  scope: DoctorScope,
): scope is Extract<DoctorScope, "all" | "knowledge"> {
  return scope === "all" || scope === "knowledge";
}
