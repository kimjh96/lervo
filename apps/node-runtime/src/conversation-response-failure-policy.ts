import type {
  ConversationResponseFailure,
  ConversationResponseFailureClassifier,
} from "@lervo/interaction";

const terminalContractFailures = new Set([
  "artifact_contract_invalid",
  "control_access_denied",
  "control_command_invalid",
  "evaluation_contract_invalid",
  "invalid_response_request",
  "invalid_writing_request",
  "managed_run_invalid",
  "message_artifact_invalid",
  "publication_permit_invalid",
  "remote_continuation_denied",
]);

const contextFailures = new Set([
  "context_injection_failed",
  "context_materialization_failed",
  "context_preparation_failed",
  "repository_snapshot_failed",
  "repository_observation_failed",
  "source_bytes_changed",
]);

const providerFailures = new Set([
  "provider_process_failed",
  "provider_protocol_failed",
  "provider_result_failed",
  "provider_start_failed",
  "provider_stop_failed",
  "provider_stream_failed",
  "provider_turn_failed",
  "provider_usage_limited",
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
        // A concurrent repository edit resolves on the next snapshot; other context failures do not.
        retryable: code === "repository_snapshot_failed" || code === "source_bytes_changed",
      };
    }
    if (code === "provider_capacity_unavailable") {
      return { failureCode: "response_provider_capacity", retryable: true };
    }
    if (code === "supervision_admission_unconfirmed") {
      return { failureCode: "response_effect_unconfirmed", retryable: true };
    }
    if (
      code === "repository_work_checkpoint_missing" ||
      code === "repository_work_knowledge_incomplete" ||
      code === "repository_work_in_progress" ||
      code === "repository_work_recovery_invalid"
    ) {
      return { failureCode: "response_effect_unconfirmed", retryable: false };
    }
    if (code !== null && providerFailures.has(code)) {
      return {
        failureCode: "response_provider_unavailable",
        // Conversation provider turns are read-only and publish only after a verified result, so
        // startup and terminal turn failures can be retried within the response-attempt budget.
        // Protocol and stream failures stay terminal because their state is ambiguous.
        retryable: code === "provider_start_failed" || code === "provider_turn_failed",
      };
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
