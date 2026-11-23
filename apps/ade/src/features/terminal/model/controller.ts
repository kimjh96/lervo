import { RequestFailure, type SessionHostClient } from "../../../platform/session-host";

/** Where terminal output goes, and where failures are shown: the view, behind an interface. */
export interface TerminalSink {
  write(bytes: Uint8Array): void;
  /** A request for the terminal failed with this protocol code. */
  failed(code: string): void;
}

const codeOf = (failure: unknown) =>
  failure instanceof RequestFailure ? failure.code : "session_host_unavailable";

/**
 * Connects one workspace's CLI conversation to a terminal. It opens the session in the CLI
 * conversation, which reuses a session that already runs, attaches from the last sequence it
 * wrote, and relays keystrokes and size changes. It attaches again after a reconnection or when
 * the session host says this client fell behind, and reports every failure to the sink.
 */
export class TerminalController {
  private sessionId: string | null = null;
  private channel: number | null = null;
  private lastSequence = 0n;
  private columns = 0;
  private rows = 0;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly client: SessionHostClient,
    private readonly workspaceId: string,
    private readonly sink: TerminalSink,
  ) {}

  async open(): Promise<void> {
    this.unsubscribe.push(
      this.client.onTerminal((frame) => {
        if (frame.channel !== this.channel || frame.sequence <= this.lastSequence) return;
        this.lastSequence = frame.sequence;
        this.sink.write(frame.bytes);
      }),
      this.client.onState((state) => {
        if (state === "connected") void this.connect();
      }),
      this.client.onMessage((message) => {
        if (message.kind === "session.resync_required" && message.sessionId === this.sessionId)
          void this.connect();
      }),
    );
    await this.connect();
  }

  close(): void {
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    // The view is gone and the session keeps running either way; a detach the connection cannot
    // carry ends with the connection, which drops this subscriber.
    if (this.sessionId !== null)
      void this.client
        .send({ kind: "session.detach", sessionId: this.sessionId })
        .catch(() => undefined);
  }

  input(bytes: Uint8Array): void {
    if (this.channel === null) return;
    this.client.input(this.channel, bytes).catch((failure: unknown) => {
      this.sink.failed(codeOf(failure));
    });
  }

  /** Sends the terminal's size when it changed. */
  resize(columns: number, rows: number): void {
    if (columns < 1 || rows < 1 || (columns === this.columns && rows === this.rows)) return;
    this.columns = columns;
    this.rows = rows;
    if (this.sessionId === null) return;
    this.client
      .send({ kind: "session.resize", sessionId: this.sessionId, columns, rows })
      .catch((failure: unknown) => this.sink.failed(codeOf(failure)));
  }

  private async connect(): Promise<void> {
    try {
      const opened = await this.client.request({
        kind: "session.open",
        workspaceId: this.workspaceId,
        conversationMode: "cli",
      });
      if (opened.kind !== "session.opened") throw new RequestFailure("answer_unexpected");
      this.sessionId = opened.sessionId;
      this.channel = opened.channel;
      await this.client.post({
        kind: "session.attach",
        sessionId: opened.sessionId,
        afterSequence: Number(this.lastSequence),
      });
      const [columns, rows] = [this.columns, this.rows];
      this.columns = 0;
      this.resize(columns, rows);
    } catch (failure) {
      this.sink.failed(codeOf(failure));
    }
  }
}
