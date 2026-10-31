import { providerCliExposedTools, providerCliRejectionReasons } from "@lervo/schemas";

export interface ProviderCliObservation {
  provider: "codex" | "claude";
  version: string;
  executableHash: string;
  admitted: boolean;
  reason: string | null;
  exposedTools: string[];
}
export interface ProviderCliAdmissionProjection {
  observedAt: string;
  detectionFailure: string | null;
  providers: ProviderCliObservation[];
  selected: { provider: "codex" | "claude"; version: string } | null;
  waiting: boolean;
}
const provider = (value: unknown) => value === "codex" || value === "claude";
const version = (value: unknown) =>
  typeof value === "string" && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]{1,40})?$/u.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join() === keys.sort().join();

/** The continuity exchange accepts no executable path, raw tool name, or provider output. */
export function isProviderCliAdmissionProjection(
  value: unknown,
): value is ProviderCliAdmissionProjection {
  if (
    !object(value) ||
    !exact(value, ["observedAt", "detectionFailure", "providers", "selected", "waiting"])
  )
    return false;
  return (
    typeof value.observedAt === "string" &&
    Number.isFinite(Date.parse(value.observedAt)) &&
    [null, "login_shell_failed", "login_shell_timed_out"].includes(
      value.detectionFailure as string | null,
    ) &&
    typeof value.waiting === "boolean" &&
    (value.selected === null ||
      (object(value.selected) &&
        exact(value.selected, ["provider", "version"]) &&
        provider(value.selected.provider) &&
        version(value.selected.version))) &&
    Array.isArray(value.providers) &&
    value.providers.length <= 32 &&
    value.providers.every(
      (item: unknown) =>
        object(item) &&
        exact(item, [
          "provider",
          "version",
          "executableHash",
          "admitted",
          "reason",
          "exposedTools",
        ]) &&
        provider(item.provider) &&
        version(item.version) &&
        typeof item.executableHash === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(item.executableHash) &&
        typeof item.admitted === "boolean" &&
        (item.reason === null ||
          providerCliRejectionReasons.includes(
            item.reason as (typeof providerCliRejectionReasons)[number],
          )) &&
        Array.isArray(item.exposedTools) &&
        item.exposedTools.length <= 16 &&
        item.exposedTools.every((name) => providerCliExposedTools.includes(name)),
    )
  );
}
