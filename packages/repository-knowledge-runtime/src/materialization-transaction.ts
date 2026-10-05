import { inspectKnowledgeMaterializationOwner } from "@lervo/repository-knowledge";

export const KNOWLEDGE_MATERIALIZATION_RECOVERY_COMMAND = "lervo knowledge materialize --recover";

/**
 * `busy` while another running process owns the materialization journal, such as a terminal
 * compile or a managed run, so a concurrent transaction never surfaces as `recovery_required`.
 * An interrupted journal keeps the explicit owner recovery of ADR-0444; the worker only names the
 * command and never rolls repository bytes back on its own.
 */
export async function materializationTransactionState(
  repositoryRoot: string,
): Promise<"clear" | "busy" | "recovery_required"> {
  const owner = await inspectKnowledgeMaterializationOwner({ repositoryRoot });
  return owner === "none" ? "clear" : owner === "live" ? "busy" : "recovery_required";
}
