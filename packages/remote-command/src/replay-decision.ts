import { RemoteCommandRuntimeError } from "./errors.js";
import { type RemoteCommandReplayDecision } from "./types.js";

export function throwRemoteCommandReplayDecision(
  decision: Exclude<RemoteCommandReplayDecision, { status: "available" | "duplicate" }>,
): never {
  const details = {
    idempotency_conflict: ["idempotency_conflict", "The idempotency key was used for a different command."],
    nonce_replay: ["nonce_replay", "The remote command nonce was reused."],
    in_progress: ["command_in_progress", "The same remote command is being processed."],
  } as const;
  const [code, message] = details[decision.status];
  throw new RemoteCommandRuntimeError(code, message);
}
