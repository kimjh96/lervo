import { resolve } from "node:path";

import {
  NoCapabilityInvocationFailure,
  type NoCapabilityJsonInvocation,
  type NoCapabilityJsonInvocationStrategy,
  type NoCapabilityJsonRunRequest,
} from "@lervo/adapter-contract";

import {
  assertCodexModelInputHasNoTools,
  codexNoCapabilityUsage,
  parseCodexNoCapabilityOutput,
} from "./no-capability-json-output.js";

const CODEX_NO_CAPABILITY_DISABLED_FEATURES = [
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

/** Ephemeral read-only `exec --json` that ignores user configuration, rules, and MCP servers. */
function codexNoCapabilityArguments(): string[] {
  return [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--json",
    "-c",
    "mcp_servers={}",
  ];
}

/** `--output-schema` reads a file, and Codex enforces only the native structured subset. */
function responseSchemaFile(request: NoCapabilityJsonRunRequest) {
  return {
    path: resolve(request.workingDirectory, "response-schema.json"),
    content: `${request.responseSchema.nativeSubset}\n`,
  };
}

function schemaConstrainedRun(
  request: NoCapabilityJsonRunRequest,
  instructions: string[],
): NoCapabilityJsonInvocation {
  const schema = responseSchemaFile(request);
  return {
    arguments: [
      ...codexNoCapabilityArguments(),
      ...instructions,
      "--output-schema",
      schema.path,
      ...codexNoCapabilityFeatureArguments(),
      ...(request.model === undefined ? [] : ["--model", request.model]),
      "-",
    ],
    files: [schema],
  };
}

export const codexNoCapabilityJsonInvocationStrategy: NoCapabilityJsonInvocationStrategy = {
  provider: "codex",
  disabledCapabilities: CODEX_NO_CAPABILITY_DISABLED_FEATURES,
  usageSemanticsId: "codex.exec-json.turn-usage.v1",
  admission: {
    kind: "model_input",
    assertNoModelTools: async (run, timeoutMs) => {
      const result = await run({
        arguments: [
          "debug",
          "prompt-input",
          "-c",
          "mcp_servers={}",
          ...codexNoCapabilityFeatureArguments(),
          "Lervo no-tool capability probe.",
        ],
        timeoutMs: Math.min(timeoutMs, 30_000),
        maxOutputBytes: 2 * 1024 * 1024,
      });
      if (result.status !== "completed")
        throw new NoCapabilityInvocationFailure(
          "policy_violation",
          "The Codex model-input capability probe did not complete.",
          {
            probeFailureReason: result.status === "timed_out" ? "probe_timed_out" : "probe_failed",
          },
        );
      assertCodexModelInputHasNoTools(result.stdout);
    },
  },
  instructedRun: (request) =>
    schemaConstrainedRun(request, [
      "-c",
      `model_reasoning_effort="${request.reasoningEffort}"`,
      ...(request.systemPrompt === undefined
        ? []
        : ["-c", `developer_instructions=${JSON.stringify(request.systemPrompt)}`]),
    ]),
  // The instruction already travels in stdin; Codex receives no separate developer prompt.
  documentNormalizationRun: (request) => schemaConstrainedRun(request, []),
  parseRun: (stdout) => {
    const result = parseCodexNoCapabilityOutput(stdout);
    return { result, usage: codexNoCapabilityUsage(stdout) };
  },
  isNativeFailureEvent: (event) => event.type === "error" || event.type === "turn.failed",
};
