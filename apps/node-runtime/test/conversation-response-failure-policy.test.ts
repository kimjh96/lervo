import { describe, expect, it } from "vitest";

import { NodeConversationResponseFailureClassifier } from "../src/conversation-response-failure-policy.js";

function coded(code: string): Error & { code: string } {
  return Object.assign(new Error("private provider or repository detail"), { code });
}

describe("Node conversation response failure policy", () => {
  const classifier = new NodeConversationResponseFailureClassifier();

  it.each([
    ["knowledge_source_unsafe", "response_context_unavailable", false],
    ["context_preparation_failed", "response_context_unavailable", false],
    ["repository_snapshot_failed", "response_context_unavailable", true],
    ["provider_start_failed", "response_provider_unavailable", true],
    ["provider_turn_failed", "response_provider_unavailable", true],
    ["provider_capacity_unavailable", "response_provider_capacity", true],
    ["provider_usage_limited", "response_provider_unavailable", false],
    ["supervision_admission_unconfirmed", "response_effect_unconfirmed", true],
    ["repository_work_checkpoint_missing", "response_effect_unconfirmed", false],
    ["repository_work_knowledge_incomplete", "response_effect_unconfirmed", false],
    ["repository_work_in_progress", "response_effect_unconfirmed", false],
    ["repository_work_recovery_invalid", "response_effect_unconfirmed", false],
    ["provider_protocol_failed", "response_provider_unavailable", false],
    ["artifact_storage_failed", "response_storage_unavailable", true],
    ["artifact_contract_invalid", "response_contract_invalid", false],
    ["evaluation_contract_invalid", "response_contract_invalid", false],
    ["publication_permit_invalid", "response_contract_invalid", false],
    ["invalid_writing_request", "response_contract_invalid", false],
    ["telemetry_recording_failed", "response_storage_unavailable", false],
    ["managed_run_invalid", "response_execution_invalid", false],
  ] as const)(
    "classifies %s without exposing native error prose",
    (code, failureCode, retryable) => {
      expect(classifier.classify(coded(code))).toEqual({ failureCode, retryable });
    },
  );

  it("does not retry an unknown deterministic failure", () => {
    expect(classifier.classify(new Error("unknown"))).toEqual({
      failureCode: "response_generation_failed",
      retryable: false,
    });
  });

  it("reports the native error to the configured private observer", () => {
    const errors: unknown[] = [];
    const observed = new NodeConversationResponseFailureClassifier((error) => errors.push(error));
    const error = coded("artifact_storage_failed");
    observed.classify(error);
    expect(errors).toEqual([error]);
  });
});
