import type { ProviderLoginContext } from "@lervo/adapter-contract";
import { isAbsolute } from "node:path";

/** Trusted host configuration; never populated from a proposed action or provider output. */
export interface NodeRuntimeReadinessConfiguration {
  workerWorkspace?: {
    parentDirectory: string;
    baseCommit: string;
    integrationTargetDigest: string;
  };
  providerLoginContexts?: Partial<Record<"codex" | "claude", ProviderLoginContext>>;
  verificationSuiteHashes?: Record<string, string>;
  providerExecutables: Partial<Record<"codex" | "claude", string>>;
  verificationTools: Record<string, readonly { toolId: string; executable: string }[]>;
}

export function snapshotRuntimeReadinessConfiguration(
  input: NodeRuntimeReadinessConfiguration | undefined,
): NodeRuntimeReadinessConfiguration | undefined {
  if (input === undefined) return undefined;
  const configuration = structuredClone(input);
  const validExecutable = (value: string) =>
    typeof value === "string" && value.length <= 4096 && !value.includes("\0") && isAbsolute(value);
  const validId = (value: string) =>
    typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/u.test(value);
  const providers = Object.entries(configuration.providerExecutables);
  const suites = Object.entries(configuration.verificationTools);
  const contexts = Object.entries(configuration.providerLoginContexts ?? {});
  const pins = Object.entries(configuration.verificationSuiteHashes ?? {});
  const tools = new Map<string, string>();
  if (
    (configuration.workerWorkspace !== undefined &&
      (Object.keys(configuration.workerWorkspace).length !== 3 ||
        !validExecutable(configuration.workerWorkspace.parentDirectory) ||
        !/^[a-f0-9]{40,64}$/u.test(configuration.workerWorkspace.baseCommit) ||
        !/^sha256:[a-f0-9]{64}$/u.test(configuration.workerWorkspace.integrationTargetDigest))) ||
    contexts.some(
      ([provider, context]) =>
        !["codex", "claude"].includes(provider) ||
        context === null ||
        typeof context !== "object" ||
        Object.keys(context).some(
          (key) => !["homeDirectory", "configurationDirectory"].includes(key),
        ) ||
        !validExecutable(context.homeDirectory) ||
        !validExecutable(context.configurationDirectory),
    ) ||
    pins.length > 32 ||
    pins.some(
      ([id, hash]) =>
        !validId(id) || typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(hash),
    ) ||
    providers.some(
      ([id, executable]) => !["codex", "claude"].includes(id) || !validExecutable(executable),
    ) ||
    suites.length > 32 ||
    suites.some(([id, entries]) => {
      if (!validId(id) || !Array.isArray(entries) || entries.length > 8) return true;
      return entries.some((tool) => {
        if (!validId(tool.toolId) || !validExecutable(tool.executable)) return true;
        const previous = tools.get(tool.toolId);
        tools.set(tool.toolId, tool.executable);
        return previous !== undefined && previous !== tool.executable;
      });
    }) ||
    tools.size > 8
  )
    throw new TypeError("The supervision runtime readiness configuration is invalid.");
  return configuration;
}
