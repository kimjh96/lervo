import { describe, expect, it } from "vitest";

import { canonicalJson, computeEventHash } from "../src/index.js";

describe("event chain contract", () => {
  it("produces the same canonical form regardless of object insertion order", () => {
    expect(canonicalJson({ z: 1, nested: { b: true, a: "x" } })).toBe(
      canonicalJson({ nested: { a: "x", b: true }, z: 1 }),
    );
  });

  it("normalizes negative zero and rejects values JSON cannot represent safely", () => {
    expect(canonicalJson({ value: -0 })).toBe('{"value":0}');
    expect(() => canonicalJson({ value: Number.NaN })).toThrow("유한한 숫자");
    expect(() => canonicalJson({ value: new Date() })).toThrow("일반 객체");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow("순환 참조");
  });

  it("hashes all chain coordinates, including the previous hash", () => {
    const event = {
      eventId: "evt_01234567",
      projectId: "prj_01234567",
      runId: "run_01234567",
      sessionId: "ses_01234567",
      seq: 1,
      type: "run.requested" as const,
      occurredAt: "2026-08-18T00:00:00Z",
      actor: { kind: "user" as const },
      schemaVersion: 1 as const,
      policyVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      payload: {},
      previousHash: null,
    };
    expect(computeEventHash(event)).not.toBe(
      computeEventHash({ ...event, previousHash: "sha256:" + "b".repeat(64) }),
    );
  });
});
