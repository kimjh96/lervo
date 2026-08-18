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

  it("keeps policy denials and pending approvals read-only", () => {
    expect(failureDispositions.capability_denied).toEqual({
      continueLocalRun: true,
      allowMutation: false,
      retryable: false,
    });
    expect(failureDispositions.approval_required).toEqual({
      continueLocalRun: true,
      allowMutation: false,
      retryable: true,
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

  it("keeps shared context events digest-only", () => {
    const published = sanitizeEventPayload("context.published", {
      sharedContextId: "scx_research_finding",
      documentId: "doc_research_finding",
      contentHash: "sha256:abc",
      producerRoleId: "researcher",
      audienceMode: "project",
      allowedRoleIds: [],
      expiresAt: null,
      documentBody: "공유 원문을 event에 복제하면 안 됩니다.",
    });
    const handoff = sanitizeEventPayload("handoff.created", {
      handoffId: "hnd_research_marketing",
      fromRoleId: "researcher",
      toRoleId: "marketer",
      sharedContextIds: ["scx_research_finding"],
      evidenceEventIds: ["evt_research_source"],
      requestDigest: "sha256:def",
      rawPrompt: "이 요청 원문도 event에 남기면 안 됩니다.",
    });

    expect(published.payload).not.toHaveProperty("documentBody");
    expect(published.redactions).toContainEqual({
      path: "$.documentBody",
      reason: "not_allowlisted",
    });
    expect(handoff.payload).not.toHaveProperty("rawPrompt");
    expect(handoff.redactions).toContainEqual({
      path: "$.rawPrompt",
      reason: "not_allowlisted",
    });
  });
});
