import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { LocalHistoryIntegrityError, verifyDeliveryRange } from "../src/delivery-verification.js";

function chain(length: number): EventEnvelope[] {
  const rows: EventEnvelope[] = [];
  for (let seq = 1; seq <= length; seq += 1)
    rows.push({
      seq,
      eventId: `evt_${String(seq).padStart(8, "0")}`,
      eventHash: `sha256:${String(seq).padStart(64, "0")}`,
      previousHash: rows.at(-1)?.eventHash ?? null,
    } as EventEnvelope);
  return rows;
}

function store(rows: EventEnvelope[]) {
  return {
    get: (eventId: string) => rows.find((row) => row.eventId === eventId) ?? null,
    list: (options?: { afterSeq?: number; limit?: number }) =>
      rows.filter((row) => row.seq > (options?.afterSeq ?? 0)).slice(0, options?.limit),
  };
}

describe("delivery range verification at use (ADR-0602)", () => {
  it("accepts a batch that is still the stored history and links to it", () => {
    const rows = chain(5);
    expect(() => verifyDeliveryRange(store(rows), rows.slice(2))).not.toThrow();
    expect(() => verifyDeliveryRange(store(rows), rows.slice(0, 2))).not.toThrow();
  });

  it("rejects a claimed event whose stored row changed after the claim", () => {
    const rows = chain(5);
    const claimed = structuredClone(rows.slice(2));
    rows[3] = { ...rows[3]!, eventHash: `sha256:${"f".repeat(64)}` };
    expect(() => verifyDeliveryRange(store(rows), claimed)).toThrow(LocalHistoryIntegrityError);
  });

  it("rejects a batch whose predecessor is missing or no longer links", () => {
    const rows = chain(5);
    const claimed = rows.slice(2);
    expect(() => verifyDeliveryRange(store(rows.filter((row) => row.seq !== 2)), claimed)).toThrow(
      "missing",
    );
    const relinked = rows.map((row) =>
      row.seq === 2 ? { ...row, eventHash: `sha256:${"e".repeat(64)}` } : row,
    );
    expect(() => verifyDeliveryRange(store(relinked), claimed)).toThrow("does not link");
  });
});
