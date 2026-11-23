import type {
  ApplicationCommandName,
  ApplicationResults,
  ClientMessage,
  HostMessage,
} from "@lervo/session-host-contract";

/** The connection to the session host, as the interface shows it. */
export type ConnectionState = "connecting" | "connected" | "reconnecting" | "unavailable";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A client message that carries a request ID, without it: the session host port assigns one. */
export type Request = DistributiveOmit<Extract<ClientMessage, { requestId: string }>, "requestId">;

/** A request the session host or the core refused, with the protocol's code and parameters. */
export class RequestFailure extends Error {
  constructor(
    readonly code: string,
    readonly parameters: Readonly<Record<string, string | number | boolean>> = {},
  ) {
    super(code);
    this.name = "RequestFailure";
  }
}

/** The protocol code of a failure; anything else means the session host could not be reached. */
export function failureCode(failure: unknown): string {
  return failure instanceof RequestFailure ? failure.code : "session_host_unavailable";
}

/**
 * What the models need from the session host: requests with answers, messages without one,
 * terminal input, and the streams of host messages, terminal frames, and connection states. Each
 * `on…` returns its unsubscribe function.
 */
export interface SessionHost {
  /** The connection's state now; `onState` reports each change. */
  readonly connection: ConnectionState;
  /**
   * Resolves with the request's answer, or rejects with a `RequestFailure`: the session host's
   * refusal, `request_timeout`, or `session_host_unavailable` when the connection ends first.
   */
  request(message: Request, deadlineMs?: number): Promise<HostMessage>;
  /** Sends a request whose success has no answer, such as `session.attach`. */
  post(message: Request): Promise<void>;
  /** Sends a message that is not a request, such as `session.detach`. */
  send(message: ClientMessage): Promise<void>;
  onMessage(listener: (message: HostMessage) => void): () => void;
  onState(listener: (state: ConnectionState) => void): () => void;
}

/**
 * Lervo application commands, which the session host forwards to the resident Lervo process. The
 * session host checks each result against its command's schema, so results arrive typed.
 */
export interface ApplicationCommands {
  run<C extends ApplicationCommandName>(
    command: C,
    arguments_?: Record<string, unknown>,
  ): Promise<ApplicationResults[C]>;
}
