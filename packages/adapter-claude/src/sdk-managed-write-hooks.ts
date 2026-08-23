import type { startup } from "@anthropic-ai/claude-agent-sdk";

import type { ClaudeToolUseHandler } from "./types.js";

type StartupInput = NonNullable<Parameters<typeof startup>[0]>;
type StartupOptions = NonNullable<StartupInput["options"]>;
type ClaudeHooks = NonNullable<StartupOptions["hooks"]>;

function isManagedWriteTool(toolName: string): toolName is "Write" | "Edit" {
  return toolName === "Write" || toolName === "Edit";
}

export function createClaudeManagedWriteHooks(input: {
  handler: () => ClaudeToolUseHandler | undefined;
  fail: (error: unknown) => never;
}): ClaudeHooks {
  return {
    PreToolUse: [
      {
        hooks: [
          async (hookInput) => {
            if (
              hookInput.hook_event_name !== "PreToolUse" ||
              !isManagedWriteTool(hookInput.tool_name)
            ) {
              return { continue: true };
            }
            let allowed = false;
            try {
              allowed =
                (await input.handler()?.authorize(
                  hookInput.tool_name,
                  hookInput.tool_input,
                  hookInput.tool_use_id,
                )) ?? false;
            } catch (error) {
              input.fail(error);
            }
            return {
              hookSpecificOutput: {
                hookEventName: "PreToolUse" as const,
                permissionDecision: allowed ? "allow" as const : "deny" as const,
                permissionDecisionReason: allowed
                  ? "A Lervo managed write permit was issued."
                  : "No Lervo managed write permit was issued.",
              },
            };
          },
        ],
      },
    ],
    PostToolUse: [
      {
        hooks: [
          async (hookInput) => {
            if (
              hookInput.hook_event_name === "PostToolUse" &&
              isManagedWriteTool(hookInput.tool_name)
            ) {
              try {
                await input.handler()?.complete(
                  hookInput.tool_name,
                  hookInput.tool_input,
                  hookInput.tool_use_id,
                  "completed",
                );
              } catch (error) {
                input.fail(error);
              }
            }
            return { continue: true };
          },
        ],
      },
    ],
    PostToolUseFailure: [
      {
        hooks: [
          async (hookInput) => {
            if (
              hookInput.hook_event_name === "PostToolUseFailure" &&
              isManagedWriteTool(hookInput.tool_name)
            ) {
              try {
                await input.handler()?.complete(
                  hookInput.tool_name,
                  hookInput.tool_input,
                  hookInput.tool_use_id,
                  "failed",
                );
              } catch (error) {
                input.fail(error);
              }
            }
            return { continue: true };
          },
        ],
      },
    ],
  };
}
