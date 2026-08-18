import { defaultProjectDataPolicy } from "@roven/schemas";

export const defaultDataPolicy = defaultProjectDataPolicy;

export const failureDispositions = {
  telemetry_recording_failed: {
    continueLocalRun: false,
    allowMutation: false,
    retryable: true,
  },
  redaction_failed: {
    continueLocalRun: false,
    allowMutation: false,
    retryable: true,
  },
  hub_sync_failed: {
    continueLocalRun: true,
    allowMutation: true,
    retryable: true,
  },
  derived_index_failed: {
    continueLocalRun: true,
    allowMutation: true,
    retryable: true,
  },
  required_context_missing: {
    continueLocalRun: false,
    allowMutation: false,
    retryable: true,
  },
  provider_capability_unsupported: {
    continueLocalRun: false,
    allowMutation: false,
    retryable: false,
  },
  capability_denied: {
    continueLocalRun: true,
    allowMutation: false,
    retryable: false,
  },
  approval_required: {
    continueLocalRun: true,
    allowMutation: false,
    retryable: true,
  },
  contract_validation_failed: {
    continueLocalRun: false,
    allowMutation: false,
    retryable: false,
  },
  writing_verification_failed: {
    continueLocalRun: false,
    allowMutation: false,
    retryable: true,
  },
  artifact_storage_failed: {
    continueLocalRun: false,
    allowMutation: false,
    retryable: true,
  },
} as const;

export type FailureCode = keyof typeof failureDispositions;
