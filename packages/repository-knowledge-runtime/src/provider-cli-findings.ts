import type { ProviderCliAdmissionProjection } from "@lervo/sync-contract";
import type { KnowledgeProviderAdmissionState } from "./provider-admission.js";
import type { ContinuityFinding } from "./continuity-findings.js";
export { readProviderCliProjection } from "./provider-cli-projection.js";

/** Upkeep belongs to provider admission, including when a fallback keeps work moving. */
export function providerCliFindings(
  state: ProviderCliAdmissionProjection | null,
  pauses: readonly (KnowledgeProviderAdmissionState & { provider: "codex" | "claude" })[] = [],
  now: Date = new Date(),
): ContinuityFinding[] {
  const findings: ContinuityFinding[] = [];
  const add = (
    code: ContinuityFinding["code"],
    severity: ContinuityFinding["severity"],
    detail: string | null,
  ) => findings.push({ code, severity, detail, actor: "provider admission" });
  for (const pause of pauses) {
    if (!pause.paused) continue;
    const age =
      pause.observedAt === null
        ? "unknown"
        : Math.max(0, now.getTime() - Date.parse(pause.observedAt));
    add(
      "provider_not_admitted",
      "attention",
      `${pause.provider}:paused:${pause.reason}:observed_at=${pause.observedAt}:age_ms=${age}:next_reprobe_at=${pause.nextReprobeAt}:reset_at=${pause.resetAt}`,
    );
  }
  if (state === null) return findings;
  if (state.detectionFailure !== null)
    add("provider_detection_failed", "attention", state.detectionFailure);
  for (const cli of state.providers) {
    const detail = `${cli.provider}:${cli.version}`;
    add("provider_cli_detected", "info", detail);
    if (!cli.admitted && cli.reason === null) continue;
    add(
      cli.admitted ? "provider_cli_admitted" : "provider_cli_rejected",
      cli.admitted ? "info" : "attention",
      cli.admitted ? detail : `${detail}:${cli.reason}`,
    );
  }
  if (state.waiting) add("provider_not_admitted", "attention", null);
  return findings.slice(0, 32);
}
