import type { ProviderRuntimeInspection } from "@lervo/adapter-contract";
import type {
  DoctorInspection,
  DoctorIssueCode,
} from "@lervo/diagnostics";

import { doctorInspection, doctorIssue } from "./doctor-inspection-result.js";

export function inspectDoctorProvider(
  result: ProviderRuntimeInspection,
): DoctorInspection {
  const checkId = result.provider === "codex"
    ? "provider_codex_runtime"
    : "provider_claude_runtime";
  if (result.status === "available" && result.version !== null) {
    return doctorInspection(checkId, "healthy", 1, [], result.version);
  }
  const code: DoctorIssueCode = result.reasonCode === "unsupported_platform"
    ? "provider_platform_unsupported"
    : result.reasonCode === "executable_not_found"
      ? "provider_executable_missing"
      : "provider_probe_failed";
  const providerName = result.provider === "codex" ? "Codex" : "Claude";
  const message = result.reasonCode === "unsupported_platform"
    ? `${providerName} runtime availability cannot be determined on this platform.`
    : result.reasonCode === "executable_not_found"
      ? `Could not find the ${providerName} executable.`
      : `Could not determine the ${providerName} executable version.`;
  return doctorInspection(checkId, "unknown", 0, [doctorIssue(code, message)]);
}
