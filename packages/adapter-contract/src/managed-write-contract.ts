import type {
  AdapterManagedWriteCompletion,
  AdapterManagedWriteDecision,
  AdapterManagedWriteRequest,
  AdapterSession,
  AdapterTurn,
} from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import {
  inspectManagedWriteCompletionBinding,
  inspectManagedWriteDecisionBinding,
  inspectManagedWriteRequestBinding,
  type ManagedWriteBindingViolation,
} from "./managed-write-binding.js";

export interface ManagedWriteContractExchange {
  session: AdapterSession;
  turn: AdapterTurn;
  request: AdapterManagedWriteRequest;
  decision: AdapterManagedWriteDecision;
  completion: AdapterManagedWriteCompletion;
}

export interface ManagedWriteContractReport {
  passed: boolean;
  violations: ManagedWriteBindingViolation[];
}

export function evaluateManagedWriteContract(
  exchange: ManagedWriteContractExchange,
): ManagedWriteContractReport {
  const violations: ManagedWriteBindingViolation[] = [];
  for (const [label, message] of [
    ["session", exchange.session],
    ["turn", exchange.turn],
    ["request", exchange.request],
    ["decision", exchange.decision],
    ["completion", exchange.completion],
  ] as const) {
    const result = validateSchema("adapter", message);
    if (!result.valid) {
      violations.push({
        code: "write_message_invalid",
        detail: `${label}: ${result.errors.map((error) => `${error.instancePath} ${error.message}`).join("; ")}`,
      });
    }
  }
  if (
    exchange.session.executionMode !== "managed_write" ||
    exchange.session.effectiveCapabilities.fileChanges !== "supported"
  ) {
    violations.push({
      code: "write_message_invalid",
      detail: "session: managed write capability is not enabled for this session.",
    });
  }
  violations.push(
    ...inspectManagedWriteRequestBinding(exchange).violations,
    ...inspectManagedWriteDecisionBinding(exchange).violations,
    ...inspectManagedWriteCompletionBinding(exchange).violations,
  );
  return { passed: violations.length === 0, violations };
}
