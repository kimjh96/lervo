import { SyncWorkerError } from "./errors.js";
import { type SyncRetryFailureCode } from "./types.js";

export class RetryableSyncFailure extends Error {
  constructor(readonly code: SyncRetryFailureCode) {
    super(code);
    this.name = "RetryableSyncFailure";
  }
}

export type RegistrationFailureCode = Exclude<
  SyncRetryFailureCode,
  "invalid_sync_ack" | "local_batch_invalid"
>;

export function registrationFailureCode(code: SyncRetryFailureCode): RegistrationFailureCode {
  if (
    code === "hub_unavailable" ||
    code === "transport_authentication_failed" ||
    code === "invalid_registration_response"
  ) {
    return code;
  }
  throw new SyncWorkerError(
    "invalid_worker_configuration",
    "registration 단계에서 허용되지 않은 실패 code가 발생했습니다.",
  );
}
