import type { HostMessage } from "@lervo/session-host-contract";

import type { SessionHostClient } from "./client";

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

const DEADLINE_MS = 130_000;
let counter = 0;

/** A fresh request identifier within the protocol's format. */
export function requestId(): string {
  counter += 1;
  return `req_${Date.now().toString(36)}_${counter.toString(36)}`;
}

type Waiting = {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: RequestFailure) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Runs application commands and answers them by request ID. One timer runs per waiting command
 * and stops when the answer arrives.
 */
export class ApplicationCommands {
  private readonly waiting = new Map<string, Waiting>();

  constructor(private readonly client: SessionHostClient) {
    client.onMessage((message) => this.receive(message));
  }

  run(command: string, arguments_: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = requestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.settle(id, new RequestFailure("request_timeout")),
        DEADLINE_MS,
      );
      this.waiting.set(id, { resolve, reject, timer });
      this.client
        .send({ kind: "application.command", requestId: id, command, arguments: arguments_ })
        .catch(() => this.settle(id, new RequestFailure("session_host_unavailable")));
    });
  }

  private receive(message: HostMessage): void {
    if (message.kind === "application.result") this.settle(message.requestId, message.result);
    if (message.kind === "request.failed")
      this.settle(message.requestId, new RequestFailure(message.code, message.parameters));
  }

  private settle(id: string, outcome: Record<string, unknown> | RequestFailure): void {
    const waiting = this.waiting.get(id);
    if (waiting === undefined) return;
    this.waiting.delete(id);
    clearTimeout(waiting.timer);
    if (outcome instanceof RequestFailure) waiting.reject(outcome);
    else waiting.resolve(outcome);
  }
}
