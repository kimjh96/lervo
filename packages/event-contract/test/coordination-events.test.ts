import { describe, expect, it } from "vitest";
import { claimRefusalCodes, validateSchema, type EventType } from "@lervo/schemas";
import { coordinationEventSchemaVersion } from "../src/event-schema-versions.js";
import { sanitizeEventPayload } from "../src/redaction.js";

const assignmentId = `asn_${"a".repeat(24)}`;
const holderAssignmentId = `asn_${"b".repeat(24)}`;
const lead = `agt_${"c".repeat(24)}`;
const holder = `agt_${"d".repeat(24)}`;
const holderWorkspaceId = `wsp_${"e".repeat(24)}`;
const occurredAt = "2026-11-27T09:00:00.000Z";

const payloads = {
  "assignment.lease.widened": {
    assignmentId,
    agentId: lead,
    leaseGeneration: 1,
    revision: 3,
    expectedPathDigest: `sha256:${"f".repeat(64)}`,
    expectedPathCount: 4,
    addedPathCount: 1,
    cause: "claim",
    occurredAt,
  },
  "assignment.claim.refused": {
    assignmentId,
    agentId: lead,
    leaseGeneration: 1,
    code: "path_leased",
    holderAgentId: holder,
    holderAssignmentId,
    holderWorkspaceId,
    pathDigest: `hmac-sha256:${"1".repeat(64)}`,
    detection: "tool",
    occurredAt,
  },
} as const satisfies Partial<Record<EventType, Record<string, unknown>>>;
type CoordinationEventType = keyof typeof payloads;
const types = Object.keys(payloads) as CoordinationEventType[];

function envelope(type: EventType, schemaVersion: number, payload: Record<string, unknown>) {
  return {
    eventId: "evt_coordination0001",
    projectId: "prj_coordination_1",
    runId: "run_coordination_1",
    sessionId: "ses_coordination_1",
    seq: 1,
    type,
    occurredAt: "2026-11-27T09:00:01.000Z",
    actor: { kind: "system" },
    schemaVersion,
    policyVersion: `sha256:${"0".repeat(64)}`,
    payload,
    previousHash: null,
    eventHash: `sha256:${"0".repeat(64)}`,
  };
}

function sanitized(type: CoordinationEventType, payload: Record<string, unknown>) {
  return sanitizeEventPayload(type, payload).payload;
}

describe("claims in ADE conversations (schema 16, Lervo ADE coordination)", () => {
  it("are event types only from schema 16", () => {
    expect(coordinationEventSchemaVersion).toBe(16);
    for (const type of types)
      for (let schemaVersion = 1; schemaVersion <= 16; schemaVersion++)
        expect(validateSchema("event", envelope(type, schemaVersion, payloads[type])).valid).toBe(
          schemaVersion >= 16,
        );
  });

  it("keep identifiers, counts, digests, and times, and drop paths, input, and messages", () => {
    for (const type of types) {
      expect(sanitized(type, payloads[type])).toEqual(payloads[type]);
      const extra = sanitizeEventPayload(type, {
        ...payloads[type],
        path: "packages/core/src/index.ts",
        command: "sed -i s/a/b/ packages/core/src/index.ts",
        message: "packages/core/src/index.ts is leased by Arin",
        toolUseId: "toolu_01ABCDEF",
      });
      expect(extra.payload, type).toEqual(payloads[type]);
      expect(extra.redactions.map((redaction) => redaction.path).sort()).toEqual([
        "$.command",
        "$.message",
        "$.path",
        "$.toolUseId",
      ]);
    }
  });

  it("accept every refusal code, detection, and cause, and null holders", () => {
    const refused = payloads["assignment.claim.refused"];
    for (const code of claimRefusalCodes)
      expect(sanitized("assignment.claim.refused", { ...refused, code })).toEqual({
        ...refused,
        code,
      });
    for (const detection of ["tool", "shell", "reconcile"])
      expect(sanitized("assignment.claim.refused", { ...refused, detection })).toEqual({
        ...refused,
        detection,
      });
    const unheld = {
      ...refused,
      code: "outside_responsibility",
      holderAgentId: null,
      holderAssignmentId: null,
      holderWorkspaceId: null,
    };
    expect(sanitized("assignment.claim.refused", unheld)).toEqual(unheld);
    const widened = payloads["assignment.lease.widened"];
    const reconciled = { ...widened, cause: "reconcile", expectedPathCount: 10_000 };
    expect(sanitized("assignment.lease.widened", reconciled)).toEqual(reconciled);
  });

  it("refuse payloads outside their closed shapes", () => {
    const widened = payloads["assignment.lease.widened"];
    const refused = payloads["assignment.claim.refused"];
    const invalid: [CoordinationEventType, Record<string, unknown>][] = [
      ["assignment.lease.widened", { ...widened, assignmentId: "asn_1" }],
      ["assignment.lease.widened", { ...widened, agentId: "owner" }],
      ["assignment.lease.widened", { ...widened, leaseGeneration: 0 }],
      ["assignment.lease.widened", { ...widened, revision: 1.5 }],
      ["assignment.lease.widened", { ...widened, expectedPathDigest: "packages/core" }],
      ["assignment.lease.widened", { ...widened, expectedPathCount: 10_001 }],
      ["assignment.lease.widened", { ...widened, addedPathCount: 0 }],
      ["assignment.lease.widened", { ...widened, cause: "renewal" }],
      ["assignment.lease.widened", { ...widened, occurredAt: "yesterday" }],
      ["assignment.claim.refused", { ...refused, code: "claim_deferred" }],
      ["assignment.claim.refused", { ...refused, code: "seal_paths_conflict" }],
      ["assignment.claim.refused", { ...refused, holderAgentId: "Arin" }],
      ["assignment.claim.refused", { ...refused, holderWorkspaceId: "wsp_1" }],
      ["assignment.claim.refused", { ...refused, pathDigest: `sha256:${"1".repeat(64)}` }],
      ["assignment.claim.refused", { ...refused, pathDigest: "packages/core/src/index.ts" }],
      ["assignment.claim.refused", { ...refused, detection: "hook" }],
      ["assignment.claim.refused", { ...refused, holderAgentId: undefined }],
    ];
    for (const [type, payload] of invalid)
      expect(() => sanitizeEventPayload(type, payload), JSON.stringify(payload)).toThrow();
  });
});

describe("an agent's conversation note (schema 16, ADR-0454)", () => {
  const promoted = {
    contextEntryId: `actx_${"a".repeat(24)}`,
    agentId: lead,
    layer: "work",
    memoryKind: "expertise",
    subjectKey: "conversation",
    audience: "agent",
    sensitivity: "internal",
    confidence: "medium",
    retrievalDigests: [`sha256:${"1".repeat(64)}`],
    observedAt: occurredAt,
    expiresAt: "2026-12-27T09:00:00.000Z",
    reviewBindingVersion: 2,
    source: {
      kind: "event",
      sourceId: `evt_${"2".repeat(32)}`,
      contentHash: `sha256:${"2".repeat(64)}`,
    },
    summaryArtifactId: `art_${"3".repeat(64)}`,
    summaryContentHash: `sha256:${"3".repeat(64)}`,
    summaryByteCount: 512,
    reviewEventId: `evt_${"4".repeat(32)}`,
    reviewEventHash: `sha256:${"4".repeat(64)}`,
    supersedesContextEntryId: null,
    promotedAt: occurredAt,
  };
  const note = { ...promoted, memoryKind: "conversation_note" };

  it("is a memory kind the payload accepts, so the envelope bounds it", () => {
    expect(sanitizeEventPayload("agent.context.promoted", note).payload).toEqual(note);
  });

  it("is refused below schema 16, while the other kinds stay readable", () => {
    const valid = (payload: Record<string, unknown>, schemaVersion: number) =>
      validateSchema("event", envelope("agent.context.promoted", schemaVersion, payload)).valid;
    for (let schemaVersion = 1; schemaVersion <= 16; schemaVersion++)
      expect(valid(note, schemaVersion), String(schemaVersion)).toBe(schemaVersion >= 16);
    expect(valid(promoted, 15)).toBe(true);
    expect(valid(promoted, 16)).toBe(true);
  });
});
