import type {
  ConversationResponseFailure,
  ConversationResponseFailureClassifier,
} from "@lervo/interaction";

const terminalContractFailures = new Set([
  "control_access_denied",
  "control_command_invalid",
  "invalid_response_request",
  "managed_run_invalid",
  "message_artifact_invalid",
  "remote_continuation_denied",
]);

const contextFailures = new Set([
  "context_injection_failed",
  "context_materialization_failed",
  "context_preparation_failed",
  "repository_snapshot_failed",
  "repository_observation_failed",
]);

const providerFailures = new Set([
  "provider_process_failed",
  "provider_protocol_failed",
  "provider_result_failed",
  "provider_start_failed",
  "provider_stop_failed",
  "provider_stream_failed",
  "provider_turn_failed",
  "session_mismatch",
  "session_not_found",
  "session_stopped",
]);

const storageFailures = new Set([
  "artifact_storage_failed",
  "repository_result_storage_failed",
  "telemetry_recording_failed",
]);

export class NodeConversationResponseFailureClassifier implements ConversationResponseFailureClassifier {
  constructor(private readonly onError?: (error: Error) => void) {}

  classify(error: unknown): ConversationResponseFailure {
    this.onError?.(
      error instanceof Error ? error : new Error("A non-Error conversation response failed."),
    );
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;
    if (code === "writing_publication_blocked") {
      return { failureCode: "response_writing_blocked", retryable: true };
    }
    if (code === "writing_evaluation_unavailable") {
      return { failureCode: "response_evaluation_unavailable", retryable: true };
    }
    if (code !== null && (code.startsWith("knowledge_") || contextFailures.has(code))) {
      return {
        failureCode: "response_context_unavailable",
        retryable: code === "repository_snapshot_failed",
      };
    }
    if (code !== null && providerFailures.has(code)) {
      return { failureCode: "response_provider_unavailable", retryable: false };
    }
    if (code !== null && storageFailures.has(code)) {
      return {
        failureCode: "response_storage_unavailable",
        retryable: code === "artifact_storage_failed",
      };
    }
    if (code !== null && terminalContractFailures.has(code)) {
      return {
        failureCode:
          code === "managed_run_invalid"
            ? "response_execution_invalid"
            : "response_contract_invalid",
        retryable: false,
      };
    }
    return { failureCode: "response_generation_failed", retryable: false };
  }
}
