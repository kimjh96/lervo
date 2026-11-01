import type { EventEnvelope } from "@lervo/schemas";
import type { ListEventsOptions, OutboxStore } from "@lervo/storage-contract";
import { describe, expect, it } from "vitest";

import { convergenceArtifactRoots } from "../src/cas-retention-policy.js";

const digest = (value: number) => value.toString(16).padStart(64, "0");

/** A chained history generated page by page, so its length costs no fixture memory. */
function generatedHistory(
  headSeq: number,
  payload: (seq: number) => Record<string, unknown>,
): OutboxStore {
  const at = (seq: number) =>
    ({
      eventId: `evt_${String(seq).padStart(24, "0")}`,
      projectId: "prj_casretention",
      runId: "run_casretention",
      sessionId: "ses_casretention",
      seq,
      type: "context.selected",
      occurredAt: "2026-11-01T00:00:00.000Z",
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion: `sha256:${"a".repeat(64)}`,
      payload: payload(seq),
      previousHash: seq === 1 ? null : `sha256:${digest(seq - 1)}`,
      eventHash: `sha256:${digest(seq)}`,
    }) as EventEnvelope;
  return {
    latest: () => at(headSeq),
    list: ({ afterSeq = 0, limit = 100, types }: ListEventsOptions = {}) =>
      types !== undefined
        ? []
        : Array.from({ length: Math.max(0, Math.min(limit, headSeq - afterSeq)) }, (_, index) =>
            at(afterSeq + index + 1),
          ),
  } as unknown as OutboxStore;
}

describe("CAS reference inventory over long history", () => {
  it("streams more than 200,000 events and bounds only the references it retains", () => {
    const artifact = digest(0xcafe);
    const roots = convergenceArtifactRoots(
      generatedHistory(200_500, (seq) => (seq % 1_000 === 0 ? { ref: `sha256:${artifact}` } : {})),
    );
    expect(roots.reachable).toEqual(new Set([artifact]));
    expect(roots.lastReference.get(artifact)).toBe(200_000);
    expect(roots.head).toBe(`sha256:${digest(200_500)}`);

    expect(() =>
      convergenceArtifactRoots(
        generatedHistory(200_001, (seq) => ({ ref: `sha256:${digest(seq + 0x100000)}` })),
      ),
    ).toThrow(/reference inventory exceeds its bound/u);
  });
});
