import type { ClientMessage, HostMessage } from "@lervo/session-host-contract";

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

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A client message that carries a request ID, without it: the requester assigns one. */
export type Request = DistributiveOmit<Extract<ClientMessage, { requestId: string }>, "requestId">;

/** How long a request waits for its answer by default. */
const DEADLINE_MS = 30_000;
/** A failure code from the shell, such as `message_invalid`, rather than an arbitrary error. */
const CODE = /^[a-z][a-z_]{0,63}$/u;

interface Pending {
  readonly resolve: (answer: HostMessage) => void;
  readonly reject: (failure: RequestFailure) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** The failure for a send the shell refused, keeping the shell's code when it gave one. */
export function sendFailure(error: unknown): RequestFailure {
  const code = error instanceof Error ? error.message : String(error);
  return new RequestFailure(CODE.test(code) ? code : "session_host_unavailable");
}

/**
 * Assigns request IDs and matches answers to them, with one deadline per request. The first
 * message that names a request answers it: `request.failed` rejects, anything else resolves.
 */
export class Requests {
  private readonly pending = new Map<string, Pending>();
  private issued = 0;

  constructor(
    private readonly options: {
      readonly send: (message: ClientMessage) => Promise<void>;
      readonly schedule: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
      readonly cancel: (timer: ReturnType<typeof setTimeout>) => void;
      /** Keeps IDs from one client run apart from another's. */
      readonly prefix: string;
    },
  ) {}

  /** A fresh request ID within the protocol's identifier format. */
  nextId(): string {
    this.issued += 1;
    return `req_${this.options.prefix}_${this.issued.toString(36)}`;
  }

  /** Sends `message` and resolves with its answer, or rejects with the failure that ends it. */
  request(message: Request, deadlineMs = DEADLINE_MS): Promise<HostMessage> {
    const requestId = this.nextId();
    return new Promise((resolve, reject) => {
      // The scheduler runs as a plain function: WebKit's `setTimeout` refuses any other receiver.
      const { schedule } = this.options;
      const timer = schedule(
        () => this.settle(requestId, new RequestFailure("request_timeout")),
        deadlineMs,
      );
      this.pending.set(requestId, { resolve, reject, timer });
      this.options
        .send({ ...message, requestId } as ClientMessage)
        .catch((error: unknown) => this.settle(requestId, sendFailure(error)));
    });
  }

  /** Settles the request that `message` answers, if any. */
  receive(message: HostMessage): void {
    if (!("requestId" in message)) return;
    this.settle(
      message.requestId,
      message.kind === "request.failed"
        ? new RequestFailure(message.code, message.parameters)
        : message,
    );
  }

  /** Fails every request in flight: the connection that would answer them ended. */
  abandon(): void {
    for (const requestId of [...this.pending.keys()])
      this.settle(requestId, new RequestFailure("session_host_unavailable"));
  }

  private settle(requestId: string, outcome: HostMessage | RequestFailure): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    this.pending.delete(requestId);
    const { cancel } = this.options;
    cancel(pending.timer);
    if (outcome instanceof RequestFailure) pending.reject(outcome);
    else pending.resolve(outcome);
  }
}
