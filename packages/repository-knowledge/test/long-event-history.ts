import type { EventEnvelope } from "@lervo/schemas";
import type { ListEventsOptions } from "@lervo/storage-contract";

/**
 * A linked project history generated page by page, so a head beyond 100,000 events costs no
 * fixture memory. Events at `executionSeqs` are privacy-valid `run.requested` originals; every
 * other event is a type that no knowledge evidence source selects. The store contract verifies
 * row hashes, so these fixtures only need consistent predecessor links.
 */
export function longEventHistory(headSeq: number, executionSeqs: readonly number[]) {
  const selected = new Set(executionSeqs);
  const at = (seq: number): EventEnvelope =>
    ({
      eventId: `evt_long${String(seq).padStart(10, "0")}`,
      projectId: "prj_longhistory",
      runId: "run_longhistory",
      sessionId: "ses_longhistory",
      seq,
      type: selected.has(seq) ? "run.requested" : "provider.process.observed",
      occurredAt: "2026-11-01T00:00:00.000Z",
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion: `sha256:${"b".repeat(64)}`,
      payload: selected.has(seq)
        ? { requestDigest: `sha256:${"a".repeat(64)}`, role: "developer", risk: "low" }
        : {},
      previousHash: seq === 1 ? null : `sha256:${(seq - 1).toString(16).padStart(64, "0")}`,
      eventHash: `sha256:${seq.toString(16).padStart(64, "0")}`,
    }) as EventEnvelope;
  return {
    at,
    latest: () => at(headSeq),
    list: (options: ListEventsOptions = {}) => {
      const page: EventEnvelope[] = [];
      for (let seq = (options.afterSeq ?? 0) + 1; seq <= headSeq; seq += 1) {
        if (page.length >= (options.limit ?? 1_000)) break;
        const event = at(seq);
        if (options.types === undefined || options.types.includes(event.type)) page.push(event);
      }
      return page;
    },
  };
}
