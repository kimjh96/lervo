import type { ClientMessage, HostMessage } from "@lervo/session-host-contract";

import type { HostTransport, ShellMessage } from "./transport";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "unavailable";

/** Terminal bytes for a channel, as the session host sequenced them. */
export interface TerminalFrame {
  readonly channel: number;
  readonly sequence: bigint;
  readonly bytes: Uint8Array;
}

const FIRST_RETRY_MS = 500;
const LAST_RETRY_MS = 10_000;

/** Splits the shell's `[channel: u32][sequence: u64][bytes]` frame. */
export function parseTerminalFrame(frame: ArrayBuffer): TerminalFrame | null {
  if (frame.byteLength < 12) return null;
  const view = new DataView(frame);
  return {
    channel: view.getUint32(0),
    sequence: view.getBigUint64(4),
    bytes: new Uint8Array(frame, 12),
  };
}

type Listener<T> = (value: T) => void;

/**
 * The interface's one connection to the session host. It reconnects after the connection ends,
 * waiting longer after each failure, and stays still while connected: no timer runs then.
 *
 * The shell keeps one connection and ends the previous one when a new one starts. Each
 * connection therefore has a generation, and messages from an earlier generation, including its
 * `host.disconnected`, are ignored; otherwise the end of a replaced connection would start
 * another, which would replace the current one, without end.
 */
export class SessionHostClient {
  private state: ConnectionState = "connecting";
  private started = false;
  private generation = 0;
  /** The last message or input handed to the shell; each waits for the one before it. */
  private outgoing: Promise<unknown> = Promise.resolve();
  private retryMs = FIRST_RETRY_MS;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly messageListeners = new Set<Listener<HostMessage>>();
  private readonly terminalListeners = new Set<Listener<TerminalFrame>>();
  private readonly stateListeners = new Set<Listener<ConnectionState>>();

  constructor(
    private readonly transport: HostTransport,
    private readonly schedule: (
      run: () => void,
      ms: number,
    ) => ReturnType<typeof setTimeout> = setTimeout,
  ) {}

  get connection(): ConnectionState {
    return this.state;
  }

  /** Connects once; later calls do nothing, so a remounted root does not open a second link. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.connect();
  }

  send(message: ClientMessage): Promise<void> {
    if (this.state !== "connected") return Promise.reject(new Error("session_host_unavailable"));
    return this.inOrder(() => this.transport.send(message));
  }

  input(channel: number, bytes: Uint8Array): Promise<void> {
    if (this.state !== "connected") return Promise.reject(new Error("session_host_unavailable"));
    return this.inOrder(() => this.transport.input(channel, bytes));
  }

  /**
   * Runs `step` after every earlier send has reached the shell. The shell handles each call as
   * its own task, so calls in flight together could arrive out of order: typed characters would
   * swap, and a resize could overtake the attach it follows.
   */
  private inOrder<T>(step: () => Promise<T>): Promise<T> {
    const next = this.outgoing.then(step, step);
    this.outgoing = next.catch(() => undefined);
    return next;
  }

  onMessage(listener: Listener<HostMessage>): () => void {
    return this.subscribe(this.messageListeners, listener);
  }

  onTerminal(listener: Listener<TerminalFrame>): () => void {
    return this.subscribe(this.terminalListeners, listener);
  }

  onState(listener: Listener<ConnectionState>): () => void {
    return this.subscribe(this.stateListeners, listener);
  }

  private subscribe<T>(listeners: Set<Listener<T>>, listener: Listener<T>): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  private async connect(): Promise<void> {
    this.timer = undefined;
    this.generation += 1;
    const generation = this.generation;
    const current = () => generation === this.generation;
    try {
      await this.transport.connect(
        (message) => {
          if (current()) this.control(message);
        },
        (frame) => {
          if (!current()) return;
          const parsed = parseTerminalFrame(frame);
          if (parsed !== null) for (const listener of this.terminalListeners) listener(parsed);
        },
      );
      if (!current()) return;
      this.retryMs = FIRST_RETRY_MS;
      this.change("connected");
    } catch {
      if (!current()) return;
      this.change("unavailable");
      this.retry();
    }
  }

  private control(message: ShellMessage): void {
    if (message.kind === "host.disconnected") {
      this.change("reconnecting");
      this.retry();
      return;
    }
    for (const listener of this.messageListeners) listener(message);
  }

  private retry(): void {
    if (this.timer !== undefined) return;
    this.timer = this.schedule(() => void this.connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, LAST_RETRY_MS);
  }

  private change(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }
}
