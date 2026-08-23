import { randomUUID } from "node:crypto";

import { type ContextEvidence, validateSchema } from "@lervo/schemas";

import { ContextPreparationError } from "./types.js";

export function defaultReceiptId(): string {
  return `ctx_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export class ContextEvidenceCollector {
  private readonly evidence: ContextEvidence[];
  private readonly receiptIds: Set<string>;

  constructor(initial: readonly ContextEvidence[] = []) {
    this.evidence = [];
    this.receiptIds = new Set();
    for (const item of initial) this.add(item);
  }

  add(item: ContextEvidence): void {
    if (this.receiptIds.has(item.receiptId)) {
      throw new ContextPreparationError(
        "receipt_id_conflict",
        `Context receipt ID is duplicated: ${item.receiptId}`,
      );
    }
    const validation = validateSchema("contextEvidence", item);
    if (!validation.valid) {
      throw new ContextPreparationError(
        "invalid_context_evidence",
        `Valid context evidence cannot be created: ${item.receiptId}`,
        { cause: validation.errors },
      );
    }
    this.receiptIds.add(item.receiptId);
    this.evidence.push(item);
  }

  values(): ContextEvidence[] {
    return [...this.evidence];
  }
}
