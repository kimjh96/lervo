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
    ["provider_turn_failed", "response_provider_unavailable", false],
    ["provider_protocol_failed", "response_provider_unavailable", false],
    ["artifact_storage_failed", "response_storage_unavailable", true],
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
