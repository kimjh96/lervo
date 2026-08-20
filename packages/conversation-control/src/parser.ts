import type { ParsedConversationControlCommand } from "./types.js";

const COMMAND = /^\/lervo[ \t]+(command|approval)[ \t]+(rcd_[a-f0-9]{64})[ \t]*$/u;

export function parseConversationControlCommand(
  content: string,
): ParsedConversationControlCommand | null {
  if (content.length > 256 || content.includes("\0")) return null;
  const match = COMMAND.exec(content);
  if (match === null) return null;
  return {
    operation: match[1] === "command" ? "command_status" : "approval_review",
    deliveryId: match[2]!,
  };
}
