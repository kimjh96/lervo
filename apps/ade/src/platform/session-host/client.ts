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
 */
export class SessionHostClient {
  private state: ConnectionState = "connecting";
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

  start(): void {
    void this.connect();
  }

  send(message: ClientMessage): Promise<void> {
    if (this.state !== "connected") return Promise.reject(new Error("session_host_unavailable"));
    return this.transport.send(message);
  }

  input(channel: number, bytes: Uint8Array): Promise<void> {
    if (this.state !== "connected") return Promise.reject(new Error("session_host_unavailable"));
    return this.transport.input(channel, bytes);
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
    try {
      await this.transport.connect(
        (message) => this.control(message),
        (frame) => {
          const parsed = parseTerminalFrame(frame);
          if (parsed !== null) for (const listener of this.terminalListeners) listener(parsed);
        },
      );
      this.retryMs = FIRST_RETRY_MS;
      this.change("connected");
    } catch {
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
