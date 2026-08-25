import type {
  AdapterManagedWriteCompletion,
  AdapterManagedWriteDecision,
  AdapterManagedWriteRequest,
  AdapterSession,
  AdapterTurn,
} from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  createManagedWriteCompletion,
  createManagedWriteDecision,
  evaluateManagedWriteContract,
} from "../src/index.js";

const capabilities = {
  controlledContextInjection: "supported",
  toolCalls: "supported",
  commandExecution: "unsupported",
  fileChanges: "supported",
  contextCompaction: "supported",
  sessionResume: "unsupported",
  usage: "unknown",
} as const;

function exchange() {
  const session: AdapterSession = {
    kind: "session",
    schemaVersion: 1,
    adapterId: "lervo/fixture",
    projectId: "prj_contract01",
    runId: "run_contract01",
    sessionId: "ses_contract01",
    roleId: "developer",
    writingPolicyId: null,
    provider: "fixture",
    providerSessionId: "provider-session-1",
    executionMode: "managed_write",
    effectiveCapabilities: capabilities,
    startedAt: "2026-08-19T00:00:00Z",
  };
  const turn: AdapterTurn = {
    kind: "turn",
    schemaVersion: 1,
    adapterId: session.adapterId,
    projectId: session.projectId,
    runId: session.runId,
    sessionId: session.sessionId,
    providerSessionId: session.providerSessionId,
    targetTurnId: "target-turn-1",
    providerTurnId: "provider-turn-1",
    acceptedAt: "2026-08-19T00:00:01Z",
  };
  const request: AdapterManagedWriteRequest = {
    kind: "managed_write_request",
    schemaVersion: 1,
    adapterId: session.adapterId,
    projectId: session.projectId,
    runId: session.runId,
    sessionId: session.sessionId,
    providerSessionId: session.providerSessionId,
    targetTurnId: turn.targetTurnId,
    providerTurnId: turn.providerTurnId,
    providerItemId: "write-1",
    path: "src/result.ts",
    targetDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    changeKind: "modified",
    requestedAt: "2026-08-19T00:00:02Z",
  };
  const decision: AdapterManagedWriteDecision = createManagedWriteDecision({
    request,
    decision: "allow",
    reasonCode: "authorized",
    decidedAt: "2026-08-19T00:00:03Z",
  });
  const completion: AdapterManagedWriteCompletion = createManagedWriteCompletion({
    request,
    status: "completed",
    completedAt: "2026-08-19T00:00:04Z",
  });
  return { session, turn, request, decision, completion };
}

describe("managed write common contract", () => {
  it("accepts one schema-valid, bound and time-ordered exchange", () => {
    expect(evaluateManagedWriteContract(exchange())).toEqual({ passed: true, violations: [] });
  });

  it("rejects a request bound to another provider turn", () => {
    const value = exchange();
    value.request.providerTurnId = "foreign-turn";
    expect(evaluateManagedWriteContract(value).violations).toContainEqual(
      expect.objectContaining({ code: "write_coordinates_mismatch" }),
    );
  });

  it("rejects responses that travel backwards in time", () => {
    const value = exchange();
    value.decision.decidedAt = "2026-08-19T00:00:00Z";
    value.completion.completedAt = "2026-08-19T00:00:00Z";
    expect(evaluateManagedWriteContract(value).violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "write_response_time_invalid" })]),
    );
  });

  it("rejects an allow decision without the authorized reason", () => {
    const value = exchange();
    value.decision.reasonCode = "capability_denied";
    expect(evaluateManagedWriteContract(value).violations).toContainEqual(
      expect.objectContaining({ code: "write_decision_invalid" }),
    );
  });

  it("rejects raw content added to a control message", () => {
    const value = exchange();
    (value.request as AdapterManagedWriteRequest & { content: string }).content = "secret";
    expect(evaluateManagedWriteContract(value).violations).toContainEqual(
      expect.objectContaining({ code: "write_message_invalid" }),
    );
  });

  it("rejects an exchange attached to a read-only session", () => {
    const value = exchange();
    value.session.executionMode = "read_only";
    value.session.effectiveCapabilities.fileChanges = "unsupported";
    expect(evaluateManagedWriteContract(value).violations).toContainEqual(
      expect.objectContaining({ code: "write_message_invalid" }),
    );
  });
});
