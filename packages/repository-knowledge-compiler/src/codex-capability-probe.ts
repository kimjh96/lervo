import { runProcess } from "./process-host.js";
import { parsedJson, policyFailure } from "./compiler-failure.js";
import { modelInputToolNames } from "./probe-tool-names.js";
export const CODEX_NO_CAPABILITY_DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "code_mode_host",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "apps",
  "plugins",
  "multi_agent",
  "image_generation",
  "view_image",
  "goals",
  "hooks",
  "tool_suggest",
  "workspace_dependencies",
  "auth_elicitation",
  "guardian_approval",
  "tool_call_mcp_elicitation",
] as const;

export function codexNoCapabilityFeatureArguments(): string[] {
  return CODEX_NO_CAPABILITY_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]);
}

export async function assertCodexHasNoModelTools(input: {
  executable: string;
  environment?: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs: number;
}): Promise<void> {
  const result = await runProcess({
    executable: input.executable,
    ...(input.environment === undefined ? {} : { environment: input.environment }),
    arguments: [
      "debug",
      "prompt-input",
      "-c",
      "mcp_servers={}",
      ...codexNoCapabilityFeatureArguments(),
      "Lervo no-tool capability probe.",
    ],
    cwd: input.cwd,
    timeoutMs: Math.min(input.timeoutMs, 30_000),
    maxOutputBytes: 2 * 1024 * 1024,
  });
  if (result.status !== "completed")
    throw Object.assign(policyFailure("The Codex model-input capability probe did not complete."), {
      probeFailureReason: result.status === "timed_out" ? "probe_timed_out" : "probe_failed",
    });
  const items = parsedJson(
    result.stdout,
    "The Codex model-input capability probe did not return JSON.",
  );
  if (
    !Array.isArray(items) ||
    items.some((item) => {
      const value = item as { type?: unknown } | null;
      return value === null || typeof value !== "object" || value.type !== "message";
    })
  ) {
    throw Object.assign(
      policyFailure("The Codex model input contains a disallowed tool or capability definition."),
      { exposedTools: modelInputToolNames(items) },
    );
  }
}
