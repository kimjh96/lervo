import { describe, expect, it } from "vitest";

import { validateSchema } from "../src/index.js";

const base = {
  kind: "normalized_event",
  schemaVersion: 1,
  eventId: "evt_provider001",
  projectId: "prj_provider001",
  runId: "run_provider001",
  sessionId: "ses_provider001",
  providerSessionId: "provider-session-1",
  occurredAt: "2026-08-18T00:00:00Z",
};

describe("provider signal schema", () => {
  it("keeps a provider file report separate from a verified file.changed event", () => {
    expect(
      validateSchema("adapter", {
        ...base,
        type: "provider.file_change.reported",
        payload: {
          providerItemId: "change-1",
          paths: ["src/index.ts"],
          changeKinds: ["modified"],
          status: "completed",
          diffDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }).valid,
    ).toBe(true);
    expect(
      validateSchema("adapter", {
        ...base,
        type: "file.changed",
        payload: { path: "src/index.ts" },
      }).valid,
    ).toBe(false);
  });

  it("rejects raw command and output fields in a normalized command event", () => {
    expect(
      validateSchema("adapter", {
        ...base,
        type: "provider.command.executed",
        payload: {
          providerItemId: "command-1",
          commandDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          cwdRelative: ".",
          status: "completed",
          exitCode: 0,
          outputDigest: null,
          durationMs: 1,
          command: "do not retain me",
        },
      }).valid,
    ).toBe(false);
  });

  it("requires turn instructions only on the local adapter message", () => {
    expect(
      validateSchema("adapter", {
        kind: "turn_request",
        schemaVersion: 1,
        adapterId: "roven/codex",
        projectId: "prj_provider001",
        runId: "run_provider001",
        sessionId: "ses_provider001",
        providerSessionId: "provider-session-1",
        targetTurnId: "turn-managed-1",
        instructions: "작업을 진행합니다.",
        requestedAt: "2026-08-18T00:00:00Z",
      }).valid,
    ).toBe(true);
  });
});
