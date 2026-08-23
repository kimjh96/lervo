import {
  canonicalJson,
  computeEventHash,
} from "@lervo/event-contract";
import {
  readTraceReport,
  type TraceReport,
  TraceReportCompatibilityError,
} from "@lervo/diagnostics";
import { describe, expect, it } from "vitest";

function event(
  input: Omit<TraceReport["events"][number], "eventHash"> |
    TraceReport["events"][number],
): TraceReport["events"][number] {
  const { eventHash: _eventHash, ...withoutHash } = input as TraceReport["events"][number];
  return { ...withoutHash, eventHash: computeEventHash(withoutHash) };
}

function validReport(): TraceReport {
  const first = event({
    eventId: "evt_trace_contract_01",
    projectId: "prj_01234567",
    runId: "run_01234567",
    sessionId: "ses_01234567",
    seq: 1,
    type: "run.requested",
    occurredAt: "2026-08-20T00:00:00Z",
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: `sha256:${"a".repeat(64)}`,
    payload: {
      requestDigest: `sha256:${"b".repeat(64)}`,
      role: "developer",
      risk: "low",
    },
    previousHash: null,
  });
  const second = event({
    ...first,
    eventId: "evt_trace_contract_02",
    seq: 2,
    type: "run.completed",
    occurredAt: "2026-08-20T00:00:01Z",
    payload: {
      resultDigest: `sha256:${"c".repeat(64)}`,
      artifactIds: [`art_${"c".repeat(64)}`],
      verificationStatus: "not_run",
    },
    previousHash: first.eventHash,
  });
  return {
    schemaVersion: 1,
    projectId: first.projectId,
    runId: first.runId,
    status: "completed",
    integrity: { valid: true, eventCount: 2, headHash: second.eventHash },
    firstOccurredAt: first.occurredAt,
    lastOccurredAt: second.occurredAt,
    sessionIds: [first.sessionId],
    events: [first, second],
  };
}

describe("trace report compatibility contract", () => {
  it("reads a valid v1 report", () => {
    const report = validReport();
    expect(readTraceReport(report)).toBe(report);
  });

  it("accepts additive fields outside the immutable event envelope", () => {
    const report = validReport();
    const extended = {
      ...report,
      generatedBy: "future-lervo",
      integrity: { ...report.integrity, algorithm: "sha256" },
    };
    expect(readTraceReport(extended)).toBe(extended);
  });

  it("distinguishes an unsupported integer schema version", () => {
    expect(() => readTraceReport({ ...validReport(), schemaVersion: 2 })).toThrowError(
      expect.objectContaining<Partial<TraceReportCompatibilityError>>({
        code: "trace_report_schema_unsupported",
      }),
    );
  });

  it.each([
    ["missing schemaVersion", (({ schemaVersion: _, ...value }) => value)(validReport())],
    ["event hash mismatch", (() => {
      const value = validReport();
      value.events[0]!.eventHash = `sha256:${"f".repeat(64)}`;
      return value;
    })()],
    ["non-allowlisted payload", (() => {
      const value = validReport();
      const changed = { ...value.events[0]!, payload: { secret: "private-token" } };
      value.events[0] = event(changed);
      return value;
    })()],
    ["different run event", (() => {
      const value = validReport();
      const changed = { ...value.events[1]!, runId: "run_87654321" };
      value.events[1] = event(changed);
      return value;
    })()],
    ["broken consecutive link", (() => {
      const value = validReport();
      const changed = { ...value.events[1]!, previousHash: `sha256:${"d".repeat(64)}` };
      value.events[1] = event(changed);
      value.integrity.headHash = value.events[1]!.eventHash;
      return value;
    })()],
    ["aggregate status mismatch", { ...validReport(), status: "incomplete" }],
    ["time range mismatch", { ...validReport(), lastOccurredAt: "2026-08-20T00:00:02Z" }],
    ["session order mismatch", { ...validReport(), sessionIds: ["ses_87654321"] }],
  ])("rejects invalid v1 semantics: %s", (_name, value) => {
    expect(() => readTraceReport(value)).toThrowError(
      expect.objectContaining<Partial<TraceReportCompatibilityError>>({
        code: "trace_report_invalid",
      }),
    );
  });

  it("keeps validation errors free of report contents", () => {
    const value = { ...validReport(), schemaVersion: "private-token" };
    expect(() => readTraceReport(value)).toThrowError(
      "The required structure of trace report v1 is invalid.",
    );
    expect(canonicalJson(value)).toContain("private-token");
  });
});
