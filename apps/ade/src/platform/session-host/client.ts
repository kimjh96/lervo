import type { ClientMessage, HostMessage } from "@lervo/session-host-contract";

import type {
  ConnectionState,
  HostIdentity,
  HostReplacement,
  Request,
  SessionHost,
} from "../../ports/session-host";
import { Requests } from "./requests";
import type { HostTransport, ShellMessage } from "./transport";

const FIRST_RETRY_MS = 500;
const LAST_RETRY_MS = 10_000;

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
export class SessionHostClient implements SessionHost, HostReplacement {
  private state: ConnectionState = "connecting";
  private hostIdentity: HostIdentity | null = null;
  /** The end of this connection was asked for, so the next one starts at once. */
  private restartRequested = false;
  private connectedOnce = false;
  private started = false;
  private generation = 0;
  /** The last message handed to the shell; each waits for the one before it. */
  private outgoing: Promise<unknown> = Promise.resolve();
  private retryMs = FIRST_RETRY_MS;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly messageListeners = new Set<Listener<HostMessage>>();
  private readonly stateListeners = new Set<Listener<ConnectionState>>();
  private readonly identityListeners = new Set<Listener<HostIdentity>>();
  private readonly requests: Requests;

  constructor(
    private readonly transport: HostTransport,
    private readonly schedule: (run: () => void, ms: number) => ReturnType<typeof setTimeout> = (
      run,
      ms,
    ) => setTimeout(run, ms),
    options: {
      readonly cancel?: (timer: ReturnType<typeof setTimeout>) => void;
      readonly requestPrefix?: string;
    } = {},
  ) {
    this.requests = new Requests({
      send: (message) => this.send(message),
      schedule,
      cancel: options.cancel ?? ((timer) => clearTimeout(timer)),
      prefix: options.requestPrefix ?? Date.now().toString(36),
    });
  }

  get connection(): ConnectionState {
    return this.state;
  }

  get identity(): HostIdentity | null {
    return this.hostIdentity;
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

  /**
   * Sends a request and resolves with its answer, or rejects with a `RequestFailure`: the
   * session host's refusal, the shell's code for a send it refused, `request_timeout`, or
   * `session_host_unavailable` when the connection ends first.
   */
  request(message: Request, deadlineMs?: number): Promise<HostMessage> {
    return this.requests.request(message, deadlineMs);
  }

  /** Sends a request whose success has no answer, such as `session.attach`. */
  post(message: Request): Promise<void> {
    return this.send({ ...message, requestId: this.requests.nextId() } as ClientMessage);
  }

  /**
   * Runs `step` after every earlier send has reached the shell. The shell handles each call as
   * its own task, so calls in flight together could arrive out of order: a message could overtake
   * the attach it follows.
   */
  private inOrder<T>(step: () => Promise<T>): Promise<T> {
    const next = this.outgoing.then(step, step);
    this.outgoing = next.catch(() => undefined);
    return next;
  }

  onMessage(listener: Listener<HostMessage>): () => void {
    return this.subscribe(this.messageListeners, listener);
  }

  onState(listener: Listener<ConnectionState>): () => void {
    return this.subscribe(this.stateListeners, listener);
  }

  onIdentity(listener: Listener<HostIdentity>): () => void {
    return this.subscribe(this.identityListeners, listener);
  }

  /**
   * Asks the shell to end the reached session host. The connection's end then reconnects at once,
   * without the backoff a failure gets, so the restart takes no longer than the new host's start.
   */
  async replace(): Promise<void> {
    this.restartRequested = true;
    try {
      await this.transport.replace();
    } catch (failure) {
      this.restartRequested = false;
      throw failure;
    }
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
      await this.transport.connect((message) => {
        if (current()) this.control(message);
      });
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
      this.requests.abandon();
      this.change("reconnecting");
      if (this.restartRequested) {
        this.restartRequested = false;
        this.retryMs = FIRST_RETRY_MS;
        if (this.timer === undefined) this.timer = this.schedule(() => void this.connect(), 0);
        return;
      }
      this.retry();
      return;
    }
    if (message.kind === "host.identified") {
      const { hostVersion, appVersion, replaceable } = message;
      this.hostIdentity = { hostVersion, appVersion, replaceable };
      for (const listener of this.identityListeners) listener(this.hostIdentity);
      return;
    }
    this.requests.receive(message);
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
    // Only the first connection times the cold start; later ones would add a mark per reconnect.
    if (state === "connected" && !this.connectedOnce) {
      this.connectedOnce = true;
      performance.mark("lervo:host-connected");
    }
    for (const listener of this.stateListeners) listener(state);
  }
}
