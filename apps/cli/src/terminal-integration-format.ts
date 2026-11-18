import type {
  TerminalIntegrationPlan,
  TerminalIntegrationReceipt,
} from "@lervo/repository-knowledge";

import { effectBackupUndoCommand } from "./effect-backup.js";

export const terminalActivation = {
  status: "action_required" as const,
  requiredOnce: {
    provider: "codex" as const,
    instruction:
      "Open Codex in this repository, run /hooks, then review and trust the Lervo UserPromptSubmit and Stop command hooks. Codex skips untrusted project hooks.",
  },
  verification:
    "Run lervo terminal status after one prompt and one completed turn in each installed provider.",
};

export function formatTerminalIntegrationPlan(terminal: TerminalIntegrationPlan): string {
  if (terminal.status === "blocked")
    return `Terminal integration migration is blocked.\n${terminal.blockers.map((item) => `  ${item.provider} [${item.code}] ${item.path}`).join("\n")}\nExisting provider settings and hooks were not changed.\n`;
  return `Terminal integration plan created.\nplan: ${terminal.planId}\ncontract: ${terminal.contractId}\nruntime: ${terminal.runtime.action} ${terminal.runtime.path}\ntargets:\n${terminal.targets.map((item) => `  ${item.provider}: ${item.action} ${item.path} · ${item.beforeHash ?? "absent"} → ${item.afterHash ?? "blocked"}`).join("\n")}${terminal.approvalHash === null ? "\nOnly the generated runtime changes." : "\nApply backs up the provider hook files, verifies the result, and restores the backup on failure."}\nExisting provider settings and hooks have not been changed. Apply it with lervo migrate knowledge --apply ${terminal.planId}.\n`;
}

export function formatTerminalIntegrationReceipt(
  receipt: TerminalIntegrationReceipt,
  backupId: string | null = null,
): string {
  return `Applied the Codex and Claude terminal integration without replacing existing provider hooks.\nplan: ${receipt.planId}\ncontract: ${receipt.contractId}\n${backupId === null ? "" : `Undo: ${effectBackupUndoCommand(backupId)}\n`}ACTION REQUIRED ONCE FOR CODEX: ${terminalActivation.requiredOnce.instruction}\nVERIFY: ${terminalActivation.verification}\n`;
}
