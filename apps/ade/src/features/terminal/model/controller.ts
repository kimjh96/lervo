import { ask, requestId, type SessionHostClient } from "../../../platform/session-host";

/** Where terminal output goes: the terminal emulator, behind an interface for tests. */
export interface TerminalSink {
  write(bytes: Uint8Array): void;
}

/**
 * Connects one workspace's CLI conversation to a terminal. It opens the session in the CLI
 * conversation, which reuses a session that already runs, attaches from the last sequence it
 * wrote, and relays keystrokes and size changes.
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
    );
    await this.connect();
  }

  close(): void {
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    if (this.sessionId !== null)
      void this.client
        .send({ kind: "session.detach", sessionId: this.sessionId })
        .catch(() => undefined);
  }

  input(bytes: Uint8Array): void {
    if (this.channel !== null) void this.client.input(this.channel, bytes).catch(() => undefined);
  }

  /** Sends the terminal's size when it changed. */
  resize(columns: number, rows: number): void {
    if (columns < 1 || rows < 1 || (columns === this.columns && rows === this.rows)) return;
    this.columns = columns;
    this.rows = rows;
    if (this.sessionId !== null)
      void this.client
        .send({ kind: "session.resize", sessionId: this.sessionId, columns, rows })
        .catch(() => undefined);
  }

  private async connect(): Promise<void> {
    const opened = await ask(this.client, {
      kind: "session.open",
      requestId: requestId(),
      workspaceId: this.workspaceId,
      conversationMode: "cli",
    });
    if (opened.kind !== "session.opened") return;
    this.sessionId = opened.sessionId;
    this.channel = opened.channel;
    await this.client.send({
      kind: "session.attach",
      requestId: requestId(),
      sessionId: opened.sessionId,
      afterSequence: Number(this.lastSequence),
    });
    const [columns, rows] = [this.columns, this.rows];
    this.columns = 0;
    this.resize(columns, rows);
  }
}
