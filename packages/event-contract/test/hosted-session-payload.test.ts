import { describe, expect, it } from "vitest";
import { validateSchema } from "@lervo/schemas";
import { sanitizeEventPayload } from "../src/redaction.js";

const digest = `sha256:${"a".repeat(64)}`;
const workspaceId = `wsp_${"b".repeat(24)}`;

const payloads = {
  "application.workspace.started": {
    workspaceId,
    workstreamId: `wks_${"c".repeat(24)}`,
    branch: "lervo/fix-the-login-form-1a2b3c",
    providerSessionDigest: digest,
    instructionDigest: digest,
    startedAt: "2026-11-23T09:00:00.000Z",
  },
  "terminal.session.launch_prepared": {
    providerSessionDigest: digest,
    provider: "claude",
    workspaceId,
    conversationMode: "native",
    descriptorDigest: digest,
  },
  "terminal.session.launched": {
    providerSessionDigest: digest,
    provider: "claude",
    descriptorDigest: digest,
  },
  "terminal.session.ended": { providerSessionDigest: digest, endReason: "other", exitCode: 0 },
} as const;

function envelope(type: string, schemaVersion: number) {
  return {
    eventId: "evt_hosted_session_01",
    projectId: "prj_hosted_session_01",
    runId: "run_hosted_session_01",
    sessionId: "ses_hosted_session_01",
    seq: 1,
    type,
    occurredAt: "2026-11-23T09:00:00.000Z",
    actor: { kind: "system" },
    schemaVersion,
    policyVersion: digest,
    payload: {},
    previousHash: null,
    eventHash: digest,
  };
}

describe("hosted session events (schema 10)", () => {
  it("are readable from schema 10", () => {
    for (const type of Object.keys(payloads))
      for (const schemaVersion of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
        expect(validateSchema("event", envelope(type, schemaVersion)).valid).toBe(
          schemaVersion >= 10,
        );
  });

  it("keep their allowlisted fields and drop instruction text and the raw session ID", () => {
    for (const [type, payload] of Object.entries(payloads)) {
      const result = sanitizeEventPayload(type as keyof typeof payloads, {
        ...payload,
        instruction: "Fix the login form",
        sessionId: "0f8f4d3e-7c1a-4a5b-9d2e-6b7c8d9e0f1a",
      });
      expect(result.payload).toEqual(payload);
      expect(result.redactions.map(({ path }) => path).sort()).toEqual([
        "$.instruction",
        "$.sessionId",
      ]);
    }
  });

  it("refuse a raw session ID, a branch Lervo did not name, and an unknown end", () => {
    for (const [type, patch] of [
      [
        "terminal.session.launched",
        { providerSessionDigest: "0f8f4d3e-7c1a-4a5b-9d2e-6b7c8d9e0f1a" },
      ],
      ["application.workspace.started", { branch: "main" }],
      ["application.workspace.started", { branch: "lervo/../../etc-1a2b3c" }],
      ["terminal.session.launch_prepared", { conversationMode: "terminal" }],
      ["terminal.session.ended", { endReason: "crashed" }],
      ["terminal.session.ended", { exitCode: 256 }],
    ] as const)
      expect(() =>
        sanitizeEventPayload(type, { ...payloads[type], ...patch } as Record<string, unknown>),
      ).toThrow();
  });

  it("record an exit by signal as a null exit code", () => {
    const ended = { providerSessionDigest: digest, endReason: "process_exited", exitCode: null };
    expect(sanitizeEventPayload("terminal.session.ended", ended).payload).toEqual(ended);
  });
});
