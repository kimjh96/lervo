import { describe, expect, it } from "vitest";

import {
  RedactionError,
  sanitizeEventPayload,
} from "../src/index.js";

describe("event payload privacy boundary", () => {
  it("removes separator, camelCase, and compatibility-form secret keys", () => {
    const result = sanitizeEventPayload("adapter.started", {
      adapterId: "lervo/codex",
      adapterVersion: "1",
      providerSessionId: "session-1",
      executionMode: "read_only",
      capabilities: {
        api_key: "secret-1",
        apiKey: "secret-2",
        rawPrompt: "secret-3",
        accessToken: "secret-4",
        secretToken: "secret-5",
        cookieValue: "secret-6",
        authorizationHeader: "secret-7",
        passwordHash: "secret-8",
        credentialValue: "secret-9",
        "ｐａｓｓｗｏｒｄ": "secret-10",
        toolCalls: "supported",
      },
    });

    expect(result.payload).toEqual({
      adapterId: "lervo/codex",
      adapterVersion: "1",
      providerSessionId: "session-1",
      executionMode: "read_only",
      capabilities: { toolCalls: "supported" },
    });
    expect(JSON.stringify(result.payload)).not.toContain("secret-");
    expect(result.redactions.filter((record) => record.reason === "sensitive_key")).toHaveLength(10);
  });

  it("rejects cyclic payloads instead of partially storing them", () => {
    const capabilities: Record<string, unknown> = { toolCalls: "supported" };
    capabilities.self = capabilities;

    expect(() =>
      sanitizeEventPayload("adapter.started", {
        adapterId: "lervo/codex",
        adapterVersion: "1",
        providerSessionId: "session-1",
        capabilities,
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "cyclic_payload" }));
  });

  it("rejects non-finite numbers and class instances", () => {
    expect(() =>
      sanitizeEventPayload("tool.called", {
        toolName: "exec",
        durationMs: Number.NaN,
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "non_finite_number" }));

    expect(() =>
      sanitizeEventPayload("adapter.started", {
        adapterId: "lervo/codex",
        adapterVersion: "1",
        providerSessionId: "session-1",
        capabilities: new Date(),
      }),
    ).toThrowError(expect.objectContaining<Partial<RedactionError>>({ code: "unsupported_value" }));
  });

  it("retains the normalized command status without retaining raw command text", () => {
    const result = sanitizeEventPayload("command.executed", {
      commandDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      cwdRelative: ".",
      status: "completed",
      exitCode: 0,
      outputDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      durationMs: 15,
      command: "cat .env",
    });

    expect(result.payload).toEqual({
      commandDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      cwdRelative: ".",
      status: "completed",
      exitCode: 0,
      outputDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      durationMs: 15,
    });
    expect(JSON.stringify(result.payload)).not.toContain("cat .env");
  });

  it("keeps migration hashes but removes reviewer and source path details", () => {
    const result = sanitizeEventPayload("document.migration.applied", {
      planId: "migp_aaaaaaaaaaaaaaaa",
      approvalId: "apr_migration_0001",
      approvalDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      beforeLayoutHash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      afterLayoutHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      sourceHashes: ["sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      candidateArtifactHashes: [
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      ],
      sidecars: [{
        documentId: "doc_readme_000001",
        contentHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      }],
      appliedAt: "2026-08-19T02:00:00Z",
      approverId: "private-reviewer",
      sourcePaths: ["README.md"],
      documentBody: "private body",
    });

    expect(result.payload).not.toHaveProperty("approverId");
    expect(result.payload).not.toHaveProperty("sourcePaths");
    expect(result.payload).not.toHaveProperty("documentBody");
    expect(result.payload).toHaveProperty("approvalDigest");
  });
});
