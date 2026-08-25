import type { ParsedConversationControlCommand } from "./types.js";

const CONTROL_COMMAND = /^\/lervo[ \t]+(command|approval)[ \t]+(rcd_[a-f0-9]{64})[ \t]*$/u;
const DELIBERATION_STATUS =
  /^\/lervo[ \t]+deliberate[ \t]+status[ \t]+(dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63})[ \t]*$/u;
const DELIBERATION_RESUME =
  /^\/lervo[ \t]+deliberate[ \t]+resume[ \t]+(dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63})[ \t]*$/u;
const DELIBERATION_START =
  /^\/lervo[ \t]+deliberate[ \t]+start[ \t]+(deliberation_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)[ \t]+--[ \t]+([^\0]+?)\s*$/u;

export function parseConversationControlCommand(
  content: string,
): ParsedConversationControlCommand | null {
  if (content.length > 4_096 || content.includes("\0")) return null;
  const control = CONTROL_COMMAND.exec(content);
  if (control !== null) {
    return {
      operation: control[1] === "command" ? "command_status" : "approval_review",
      deliveryId: control[2]!,
    };
  }
  const status = DELIBERATION_STATUS.exec(content);
  if (status !== null) {
    return { operation: "deliberation_status", deliberationId: status[1]! };
  }
  const resume = DELIBERATION_RESUME.exec(content);
  if (resume !== null) {
    return { operation: "deliberation_resume", deliberationId: resume[1]! };
  }
  const start = DELIBERATION_START.exec(content);
  if (start === null || start[2]!.trim().length === 0) return null;
  return { operation: "deliberation_start", policyId: start[1]!, topic: start[2]!.trim() };
}
