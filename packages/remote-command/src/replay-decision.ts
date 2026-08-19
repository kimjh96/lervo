import { RemoteCommandRuntimeError } from "./errors.js";
import { type RemoteCommandReplayDecision } from "./types.js";

export function throwRemoteCommandReplayDecision(
  decision: Exclude<RemoteCommandReplayDecision, { status: "available" | "duplicate" }>,
): never {
  const details = {
    idempotency_conflict: ["idempotency_conflict", "idempotency key가 다른 command에 사용되었습니다."],
    nonce_replay: ["nonce_replay", "remote command nonce가 다시 사용되었습니다."],
    in_progress: ["command_in_progress", "동일한 remote command가 처리 중입니다."],
  } as const;
  const [code, message] = details[decision.status];
  throw new RemoteCommandRuntimeError(code, message);
}
