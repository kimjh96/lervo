import { describe, expect, it } from "vitest";

import {
  defaultDataPolicy,
  failureDispositions,
  sanitizeEventPayload,
} from "../src/index.js";

describe("M0 data policy and failure semantics", () => {
  it("defaults to local-only, digest-oriented storage", () => {
    expect(defaultDataPolicy).toEqual({
      eventMetadataRetentionDays: 90,
      artifactRetentionDays: 30,
      persistRawPrompts: false,
      persistDocumentBodiesInEvents: false,
      hubSyncEnabled: false,
      eventPayloadMode: "allowlist",
    });
  });

  it("blocks mutation when telemetry cannot be recorded", () => {
    expect(failureDispositions.telemetry_recording_failed).toMatchObject({
      continueLocalRun: false,
      allowMutation: false,
    });
  });

  it("blocks mutation when redaction cannot complete", () => {
    expect(failureDispositions.redaction_failed).toMatchObject({
      continueLocalRun: false,
      allowMutation: false,
    });
  });

  it("continues locally when only Hub sync fails", () => {
    expect(failureDispositions.hub_sync_failed).toMatchObject({
      continueLocalRun: true,
      allowMutation: true,
    });
  });

  it("blocks a run whose role, skill, or document contract is invalid", () => {
    expect(failureDispositions.contract_validation_failed).toEqual({
      continueLocalRun: false,
      allowMutation: false,
      retryable: false,
    });
  });

  it("blocks publication when human-readable output fails its writing contract", () => {
    expect(failureDispositions.writing_verification_failed).toEqual({
      continueLocalRun: false,
      allowMutation: false,
      retryable: true,
    });
  });

  it("blocks dependent mutation when artifact storage is unavailable or corrupt", () => {
    expect(failureDispositions.artifact_storage_failed).toEqual({
      continueLocalRun: false,
      allowMutation: false,
      retryable: true,
    });
  });

  it("drops non-allowlisted and nested sensitive payload fields", () => {
    const result = sanitizeEventPayload("tool.called", {
      toolName: "exec",
      inputDigest: "sha256:abc",
      prompt: "do not persist me",
      status: "completed",
      durationMs: 3,
      metadata: { api_token: "secret" },
    });

    expect(result.payload).toEqual({
      toolName: "exec",
      inputDigest: "sha256:abc",
      status: "completed",
      durationMs: 3,
    });
    expect(result.redactions).toEqual(
      expect.arrayContaining([
        { path: "$.prompt", reason: "not_allowlisted" },
        { path: "$.metadata", reason: "not_allowlisted" },
      ]),
    );
  });

  it("redacts sensitive keys nested inside an allowlisted field", () => {
    const result = sanitizeEventPayload("adapter.started", {
      adapterId: "roven/codex",
      adapterVersion: "0.0.0",
      providerSessionId: "provider-session-1",
      capabilities: {
        toolCalls: "supported",
        api_key: "secret",
      },
    });

    expect(result.payload.capabilities).toEqual({ toolCalls: "supported" });
    expect(result.redactions).toContainEqual({
      path: "$.capabilities.api_key",
      reason: "sensitive_key",
    });
  });
});
