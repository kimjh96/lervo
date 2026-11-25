// Stopping a hosted native conversation's running turn while keeping its session: the provider
// ends the turn where it is and waits for the next message.
import type { HostedDecodedEvent } from "./hosted-session.js";

/** A stream decoder that can stop the provider's running turn. */
export interface HostedTurnInterrupting {
  /**
   * The bytes that ask the provider to stop the running turn, and what to show now. With no turn
   * running, `input` is empty and nothing is sent.
   */
  interrupt(): { readonly input: Uint8Array; readonly events: readonly HostedDecodedEvent[] };
}

/** Whether a decoder can stop a running turn. */
export function interruptsTurns(decoder: object): decoder is HostedTurnInterrupting {
  return typeof (decoder as Partial<HostedTurnInterrupting>).interrupt === "function";
}
