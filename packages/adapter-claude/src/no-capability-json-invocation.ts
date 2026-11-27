// The package exports this module alone as `./no-capability-json`, so the knowledge compiler's
// composition reaches the Claude CLI translation without loading the Agent SDK.
import type { NoCapabilityJsonInvocationStrategy } from "@lervo/adapter-contract";

import {
  assertClaudeAdmissionResponse,
  claudeNoCapabilityUsage,
  parseClaudeNoCapabilityOutput,
} from "./no-capability-json-output.js";

/** Print mode with every built-in tool, MCP server, customization, and session store disabled. */
function claudeNoCapabilityArguments(): string[] {
  return [
    "--print",
    "--output-format",
    "json",
    "--input-format",
    "text",
    "--tools",
    "",
    "--safe-mode",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--no-chrome",
    "--permission-mode",
    "dontAsk",
  ];
}

// Canonical JSON (sorted keys) of the admission request.
const ADMISSION_REQUEST = JSON.stringify({
  instruction: 'Return exactly {"ok":true}. You have no tools. Do not request or use tools.',
  task: "provider_cli_admission_probe",
});

export const claudeNoCapabilityJsonInvocationStrategy: NoCapabilityJsonInvocationStrategy = {
  provider: "claude",
  disabledCapabilities: ["all-built-in-tools", "all-mcp", "all-customizations"],
  usageSemanticsId: "claude.print-json.model-usage.v1",
  admission: {
    kind: "model_call",
    arguments: claudeNoCapabilityArguments(),
    stdin: ADMISSION_REQUEST,
    usage: claudeNoCapabilityUsage,
    assertAdmitted: assertClaudeAdmissionResponse,
  },
  instructedRun: (request) => ({
    arguments: [
      ...claudeNoCapabilityArguments(),
      "--effort",
      request.reasoningEffort,
      ...(request.systemPrompt === undefined ? [] : ["--system-prompt", request.systemPrompt]),
      "--json-schema",
      request.responseSchema.requested,
      ...(request.model === undefined ? [] : ["--model", request.model]),
    ],
    files: [],
  }),
  documentNormalizationRun: (request) => ({
    arguments: [
      ...claudeNoCapabilityArguments(),
      "--json-schema",
      request.responseSchema.requested,
      "--system-prompt",
      request.instruction,
      ...(request.model === undefined ? [] : ["--model", request.model]),
    ],
    files: [],
  }),
  parseRun: (stdout) => {
    const result = parseClaudeNoCapabilityOutput(stdout);
    return { result, usage: claudeNoCapabilityUsage(stdout) };
  },
  isNativeFailureEvent: (event) => event.type === "result" && event.is_error === true,
};
