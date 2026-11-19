import {
  documentLifecycleStates,
  type DocumentLifecycleEntry,
  type DocumentLifecycleEvidence,
  type DocumentLifecycleState,
  type DocumentLifecycleSummary,
} from "./document-lifecycle-model.js";

export interface DocumentLifecycleOutcome {
  entries: ReadonlyMap<string, DocumentLifecycleEntry>;
  /** Documents whose evaluation failed; they stay `suspect` and count as unknown. */
  unavailable: ReadonlySet<string>;
  summary: DocumentLifecycleSummary;
}

/** Counts per state, per open resolution, per reverse-lookup outcome, and cadence coverage. */
export function summarizeDocumentLifecycle(input: {
  entries: ReadonlyMap<string, DocumentLifecycleEntry>;
  unavailable: ReadonlySet<string>;
  /** Documents the reverse lookup reached in this run, with the reasons they still have open. */
  reached: ReadonlyMap<string, readonly DocumentLifecycleEvidence[]>;
  cadence: Omit<DocumentLifecycleSummary["cadence"], "remainingDays"> & { reachable: number };
}): DocumentLifecycleOutcome {
  const states = Object.fromEntries(documentLifecycleStates.map((state) => [state, 0])) as Record<
    DocumentLifecycleState,
    number
  >;
  const suspects = { mechanical: 0, provider: 0, cadence: 0, unknown: 0 };
  for (const entry of input.entries.values()) {
    states[entry.state] += 1;
    if (entry.state !== "suspect") continue;
    if (input.unavailable.has(entry.path)) suspects.unknown += 1;
    else if (entry.reasons.some((reason) => reason.resolution === "provider"))
      suspects.provider += 1;
    else if (entry.reasons.some((reason) => reason.resolution === "mechanical"))
      suspects.mechanical += 1;
    else suspects.cadence += 1;
  }
  const resolution = { deterministic: 0, mechanical: 0, provider: 0 };
  for (const reasons of input.reached.values()) {
    if (reasons.some((reason) => reason.resolution === "provider")) resolution.provider += 1;
    else if (reasons.some((reason) => reason.resolution === "mechanical"))
      resolution.mechanical += 1;
    else resolution.deterministic += 1;
  }
  const { reachable, ...cadence } = input.cadence;
  return {
    entries: input.entries,
    unavailable: input.unavailable,
    summary: {
      states,
      suspects,
      resolution,
      cadence: { ...cadence, remainingDays: Math.ceil(reachable / cadence.perDay) },
    },
  };
}
