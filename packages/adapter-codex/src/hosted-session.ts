import {
  assertHostedLaunchIntent,
  type HostedLaunch,
  type HostedLaunchIntent,
  type HostedSessionAdapter,
  type HostedSessionCapabilities,
} from "@lervo/adapter-contract";

/**
 * The Codex CLI's hosted sessions. Codex assigns its own session ID after start, so Lervo cannot
 * bind one before launch, and resuming needs the ID that Codex reports. The native conversation
 * stays undeclared until its decoder passes against a real Codex session; until then, Codex
 * sessions use the CLI conversation, which every installation supports.
 */
export const codexHostedCapabilities: HostedSessionCapabilities = {
  nativeConversation: false,
  sessionIdBinding: false,
  hooks: false,
  mcp: false,
  systemPromptFile: false,
  resume: false,
};

export function createCodexHostedSessionAdapter(executable = "codex"): HostedSessionAdapter {
  return {
    provider: "codex",
    capabilities: codexHostedCapabilities,
    prepareLaunch(intent: HostedLaunchIntent): HostedLaunch {
      assertHostedLaunchIntent(intent, codexHostedCapabilities);
      const model = intent.model === undefined ? [] : ["--model", intent.model];
      const instruction = intent.start.kind === "new" ? [intent.start.instruction] : [];
      return {
        program: executable,
        arguments: [...model, ...instruction],
        environment: {},
        workingDirectory: intent.workingDirectory,
        mode: intent.mode,
        initialInput: null,
        // No Codex session marker is known to change a child's behavior.
        environmentRemove: [],
      };
    },
  };
}
