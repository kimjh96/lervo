import type { ClientMessage, HostMessage } from "@lervo/session-host-contract";

import type { SessionHostClient } from "./client";
import { RequestFailure } from "./requests";

const DEADLINE_MS = 30_000;

/**
 * Sends a request and resolves with the first host message that answers its `requestId`, or
 * rejects with the `request.failed` that refuses it.
 */
export function ask(
  client: SessionHostClient,
  message: ClientMessage & { requestId: string },
): Promise<HostMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new RequestFailure("request_timeout")), DEADLINE_MS);
    const unsubscribe = client.onMessage((answer) => {
      if (!("requestId" in answer) || answer.requestId !== message.requestId) return;
      finish(
        answer.kind === "request.failed"
          ? new RequestFailure(answer.code, answer.parameters)
          : answer,
      );
    });
    function finish(outcome: HostMessage | RequestFailure) {
      clearTimeout(timer);
      unsubscribe();
      if (outcome instanceof RequestFailure) reject(outcome);
      else resolve(outcome);
    }
    client.send(message).catch(() => finish(new RequestFailure("session_host_unavailable")));
  });
}
