// The native conversation's decoding contract (Lervo ADE sessions, "Native conversation"): what a
// provider adapter decodes from its structured stream and reads from its own transcript.
import type { HostedImageMark } from "./hosted-images.js";
import type { HostedSessionAdapter } from "./hosted-session.js";
import type { HostedToolDetail } from "./hosted-tool-detail.js";

/**
 * What a conversation item holds. Tool activity holds a bounded detail of what the call acted on
 * and showed; the provider's transcript keeps the full input and output.
 */
export type HostedDecodedContent =
  | {
      readonly kind: "user_message" | "agent_message" | "question";
      readonly text: string;
      /** What the conversation keeps of the images a user message carried. */
      readonly images?: readonly HostedImageMark[];
      /**
       * A question's choices, when the agent asked with them and the person can answer in the
       * interface (Lervo ADE sessions, "Questions").
       */
      readonly choices?: HostedChoices;
    }
  | {
      readonly kind: "tool_activity";
      readonly name: string;
      readonly status: "running" | "succeeded" | "failed";
      readonly calls: number;
      readonly detail?: HostedToolDetail;
      /**
       * A shell call's output, at most `MAX_TOOL_OUTPUT_CHARACTERS`, for the core within the
       * resident process. The core link removes it before the session host receives the item.
       */
      readonly output?: string;
      /**
       * The provider's ID for the call, for the core within the resident process, which joins it
       * to the claim Lervo made for the call. The core link removes it before the session host
       * receives the item.
       */
      readonly toolUseId?: string;
    }
  | {
      /** A message another agent session sent this one. */
      readonly kind: "peer_message";
      readonly from: string;
      readonly text: string;
    }
  | {
      readonly kind: "lervo_notice";
      readonly code: string;
      readonly parameters: Readonly<Record<string, string | number | boolean>>;
    };

/** One question an agent asks with choices, as the provider's tool put it. */
export interface HostedQuestion {
  readonly question: string;
  /** A short label for the question, such as "Color". */
  readonly header: string;
  readonly multiSelect: boolean;
  readonly options: readonly { readonly label: string; readonly description: string }[];
}

/** The questions of one request, which one answer settles. */
export interface HostedChoices {
  readonly requestId: string;
  readonly questions: readonly HostedQuestion[];
}

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

/**
 * A decoder that lets the person answer an agent's questions with choices (Lervo ADE sessions,
 * "Questions"). It answers what it cannot ask itself, so the provider never waits on it.
 */
export interface HostedQuestionAnswering {
  /** Encodes the person's answers to `requestId`, each by its question, with what to show. */
  answer(
    requestId: string,
    answers: Readonly<Record<string, string>>,
  ): { readonly input: Uint8Array; readonly events: readonly HostedDecodedEvent[] };
  /** Bytes the decoder must write without being asked, such as allowing a tool; empty when none. */
  takeReplies(): Uint8Array;
}

/** Whether `decoder` answers questions with choices. */
export function answersQuestions(
  decoder: HostedStreamDecoder,
): decoder is HostedStreamDecoder & HostedQuestionAnswering {
  return typeof (decoder as Partial<HostedQuestionAnswering>).answer === "function";
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
