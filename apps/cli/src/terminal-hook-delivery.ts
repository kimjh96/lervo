// How a hook that runs in its own process came to run there, for the schema-13 `delivery` of its
// stage observation (execution-stages-observed.md#hook-delivery-schema-13).
import type { terminalHookDeliveryFallbacks } from "@lervo/schemas";

import type { TerminalContextDecline } from "./terminal-context-request.js";

type Fallback = (typeof terminalHookDeliveryFallbacks)[number];
export type TerminalHookDelivery =
  | { channel: "context_server"; answerMilliseconds?: number }
  | { channel: "in_process"; fallback: Fallback };

/**
 * What the launcher leaves before it loads the runtime in its own process: `none` when it found no
 * socket, an empty string once it starts offering a request, then, if the offer failed, the
 * connection state it failed in or the server's decline line. An older launcher leaves nothing.
 */
export const TERMINAL_HOOK_OFFER = Symbol.for("lervo.terminalHook.offer");

const declines: Record<TerminalContextDecline, Fallback> = {
  runtime_mismatch: "declined_runtime_mismatch",
  environment_mismatch: "declined_environment_mismatch",
  busy: "declined_busy",
  request_too_large: "declined_request_too_large",
  invalid_request: "declined_invalid_request",
};

/** Maps the launcher's offer outcome to the closed fallback reason it stands for. */
export function inProcessHookFallback(
  offer: unknown,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Fallback {
  if (environment.LERVO_TERMINAL_CONTEXT_SOCKET === "0") return "disabled";
  if (typeof offer !== "string") return platform === "win32" ? "not_offered" : "unreported";
  if (offer === "none") return "no_server";
  // A socket, but a request the launcher does not offer, such as an oversized input.
  if (offer === "") return "not_offered";
  if (offer.startsWith("{")) {
    try {
      const reason = (JSON.parse(offer.split("\n", 1)[0] ?? "") as { declined?: unknown }).declined;
      if (typeof reason === "string" && Object.hasOwn(declines, reason))
        return declines[reason as TerminalContextDecline];
    } catch {
      // A decline line cut short says no more than a socket that did not answer.
    }
  }
  return "unreachable";
}

/** This process's delivery, read once before the hook runs. */
export function inProcessHookDelivery(): TerminalHookDelivery {
  return {
    channel: "in_process",
    fallback: inProcessHookFallback((globalThis as Record<symbol, unknown>)[TERMINAL_HOOK_OFFER]),
  };
}
