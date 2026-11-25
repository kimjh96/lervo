// The native conversation's decoding contract (Lervo ADE sessions, "Native conversation"): what a
// provider adapter decodes from its structured stream and reads from its own transcript.
import type { HostedSessionAdapter } from "./hosted-session.js";
import type { HostedToolDetail } from "./hosted-tool-detail.js";

/**
 * What a conversation item holds. Tool activity holds a bounded detail of what the call acted on
 * and showed; the provider's transcript keeps the full input and output.
 */
export type HostedDecodedContent =
  | { readonly kind: "user_message" | "agent_message" | "question"; readonly text: string }
  | {
      readonly kind: "tool_activity";
      readonly name: string;
      readonly status: "running" | "succeeded" | "failed";
      readonly calls: number;
      readonly detail?: HostedToolDetail;
    }
  | {
      readonly kind: "lervo_notice";
      readonly code: string;
      readonly parameters: Readonly<Record<string, string | number | boolean>>;
    };

/** One decoded change, in the order the session host applies it (the core-link protocol). */
export type HostedDecodedEvent =
  | { readonly kind: "status"; readonly event: "turn_started" | "question_asked" | "turn_finished" }
  | {
      readonly kind: "item" | "start";
      readonly content: HostedDecodedContent;
      readonly createdAtMs: number;
    }
  | { readonly kind: "delta"; readonly text: string }
  | { readonly kind: "finish" };

/**
 * Translates one native conversation between the provider's structured stream and common
 * conversation events. It keeps its own state, such as a partial line, for one session.
 */
export interface HostedStreamDecoder {
  /** The bytes for the provider's standard input, and what to show for the user's text. */
  send(text: string): {
    readonly input: Uint8Array;
    readonly events: readonly HostedDecodedEvent[];
  };
  /** Decodes a chunk of standard output. A chunk may end anywhere, even inside a character. */
  output(chunk: Uint8Array): readonly HostedDecodedEvent[];
}

/** A hosted-session adapter whose provider supports the native conversation. */
export interface HostedStreamDecoding {
  createStreamDecoder(): HostedStreamDecoder;
}

/** One complete item of a provider's own transcript, as the native conversation shows it. */
export interface HostedTranscriptItem {
  readonly content: HostedDecodedContent;
  readonly createdAtMs: number;
}

/**
 * A hosted-session adapter that reads its provider's own transcript of a session: the canonical
 * conversation, which includes turns from either conversation mode (invariant 4). The session
 * host rebuilds the native conversation's index from it.
 */
export interface HostedTranscriptReading {
  /** The session's items, oldest first; none when the provider kept no transcript. */
  readTranscript(session: {
    readonly sessionId: string;
    readonly workingDirectory: string;
  }): AsyncIterable<HostedTranscriptItem>;
}

/** Whether `adapter` can read its provider's transcript. */
export function hasTranscriptReader(
  adapter: HostedSessionAdapter,
): adapter is HostedSessionAdapter & HostedTranscriptReading {
  return typeof (adapter as Partial<HostedTranscriptReading>).readTranscript === "function";
}

/** Whether `adapter` can decode the native conversation it declares. */
export function hasStreamDecoder(
  adapter: HostedSessionAdapter,
): adapter is HostedSessionAdapter & HostedStreamDecoding {
  return typeof (adapter as Partial<HostedStreamDecoding>).createStreamDecoder === "function";
}
