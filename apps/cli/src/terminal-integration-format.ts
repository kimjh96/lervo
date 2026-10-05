import type {
  TerminalIntegrationPlan,
  TerminalIntegrationReceipt,
} from "@lervo/repository-knowledge";

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
  return `${terminal.status === "ready" ? "Terminal runtime reconciliation plan created." : "Terminal integration review plan created."}\nplan: ${terminal.planId}\ncontract: ${terminal.contractId}\nruntime: ${terminal.runtime.action} ${terminal.runtime.path}\ntargets:\n${terminal.targets.map((item) => `  ${item.provider}: ${item.action} ${item.path} · ${item.beforeHash ?? "absent"} → ${item.afterHash ?? "blocked"}`).join("\n")}${terminal.approvalHash === null ? "\nNo user-owned hook bytes require approval." : `\napproval: ${terminal.operationId}=${terminal.approvalHash}`}\nExisting provider settings and hooks have not been changed.\n`;
}

export function formatTerminalIntegrationReceipt(receipt: TerminalIntegrationReceipt): string {
  return `Applied the Codex and Claude terminal integration without replacing existing provider hooks.\nplan: ${receipt.planId}\ncontract: ${receipt.contractId}\nACTION REQUIRED ONCE FOR CODEX: ${terminalActivation.requiredOnce.instruction}\nVERIFY: ${terminalActivation.verification}\n`;
}
