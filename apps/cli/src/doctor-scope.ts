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
  all: "all",
  knowledge: "knowledge",
  documents: "documents",
  skills: "skills",
  providers: "agent runtimes",
  search: "search",
} as const satisfies Record<DoctorScope, string>;

function isDoctorScope(value: string): value is DoctorScope {
  return doctorScopeValues.some((scope) => scope === value);
}

export function parseDoctorScope(value: string | undefined): DoctorScope {
  const candidate = value ?? "all";
  if (isDoctorScope(candidate)) return candidate;
  throw new TypeError(`Unsupported doctor scope: ${candidate}`);
}

export function doctorScopeLabel(scope: DoctorScope): string {
  return scopeLabels[scope];
}

export function doctorScopeUsesProjectStorage(
  scope: DoctorScope,
): scope is Extract<DoctorScope, "all" | "knowledge"> {
  return scope === "all" || scope === "knowledge";
}
