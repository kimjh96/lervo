import type { HostedStreamDecoder, HostedTranscriptItem } from "@lervo/adapter-contract";
import { validateCoreLinkRequest } from "@lervo/session-host-contract";

import { errorCode } from "./command-error-output.js";
import type { RepositorySummary, WorkspaceSummary } from "./workspace-list-service.js";
import type { WorkspaceStartResult } from "./workspace-start.js";
import type { WorkspaceOpenResult } from "./workspace-launch-service.js";

/** Bytes in one request line. A `decoder.output` request carries at most 1 MiB as Base64. */
export const MAX_REQUEST_LINE_BYTES = 2 * 1024 * 1024;
/** Decoders open at once. Each belongs to one native session of the session host. */
export const MAX_OPEN_DECODERS = 256;

type Request = { kind: string; id: number } & Record<string, unknown>;
type Started = WorkspaceStartResult | WorkspaceOpenResult;

/** What the core link asks of the Lervo core. Failures are thrown with a stable `code`. */
export interface CoreLinkHandlers {
  startWorkspace(arguments_: Record<string, unknown>): Promise<WorkspaceStartResult>;
  listWorkspaces(): Promise<{ workspaces: WorkspaceSummary[] }>;
  listRepositories(): Promise<{ repositories: RepositorySummary[] }>;
  openWorkspace(workspaceId: string, mode?: "native" | "cli"): Promise<WorkspaceOpenResult>;
  createDecoder(provider: string): HostedStreamDecoder;
  readTranscript(
    workspaceId: string,
    offset: number,
    limit: number,
  ): Promise<{ items: HostedTranscriptItem[]; complete: boolean }>;
}

/** Why the core link ended. `message_invalid` means the session host sent a malformed line. */
export type CoreLinkEnd = "input_closed" | "message_invalid";

/**
 * The resident Lervo process's side of the core link (core-link protocol). It reads one request
 * per line, validates it against the contract, and answers each by its `id`. Commands run
 * concurrently; decoder requests are answered at once, in order, so a decoder's state follows
 * the provider's stream exactly.
 */
export class CoreLinkServer {
  private readonly decoders = new Map<string, HostedStreamDecoder>();
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly handlers: CoreLinkHandlers,
    private readonly write: (line: string) => void,
  ) {}

  /** Serves until the input ends or a malformed line arrives, then lets running commands finish. */
  async serve(input: AsyncIterable<Uint8Array | string>): Promise<CoreLinkEnd> {
    let end: CoreLinkEnd = "input_closed";
    for await (const line of lines(input)) {
      if (line === null || !this.receive(line)) {
        end = "message_invalid";
        break;
      }
    }
    await Promise.allSettled([...this.pending]);
    return end;
  }

  private receive(line: string): boolean {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      return false;
    }
    // The contract's standalone validator, compiled at build time from the core-link document.
    if (!validateCoreLinkRequest(request)) return false;
    this.handle(request as Request);
    return true;
  }

  private handle(request: Request): void {
    switch (request.kind) {
      case "core.command":
        this.command(request);
        return;
      case "core.open":
        this.track(request.id, () =>
          this.handlers.openWorkspace(
            request.workspaceId as string,
            request.mode as "native" | "cli" | undefined,
          ),
        );
        return;
      case "decoder.open":
        this.openDecoder(request);
        return;
      case "transcript.read":
        this.page(request);
        return;
      default:
        this.decode(request);
    }
  }

  /** Commands that start work answer with a launch; list commands answer with their result. */
  private command(request: Request): void {
    switch (request.command) {
      case "workspace.list":
        this.respond(request.id, () => this.handlers.listWorkspaces());
        return;
      case "repository.list":
        this.respond(request.id, () => this.handlers.listRepositories());
        return;
      default:
        this.track(request.id, () =>
          this.handlers.startWorkspace(request.arguments as Record<string, unknown>),
        );
    }
  }

  private page(request: Request): void {
    const task = this.handlers
      .readTranscript(
        request.workspaceId as string,
        request.offset as number,
        request.limit as number,
      )
      .then(
        (page) => this.write(JSON.stringify({ kind: "transcript.page", id: request.id, ...page })),
        (error: unknown) => this.fail(request.id, error),
      );
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  private respond(id: number, run: () => Promise<object>): void {
    const task = run().then(
      (result) => this.write(JSON.stringify({ kind: "core.result", id, result })),
      (error: unknown) => this.fail(id, error),
    );
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  private track(id: number, run: () => Promise<Started>): void {
    const task = run().then(
      (started) => this.answer(started, id),
      (error: unknown) => this.fail(id, error),
    );
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  private answer(started: Started, id: number): void {
    const { launch, ...result } = started;
    this.write(
      JSON.stringify({
        kind: "core.result",
        id,
        result,
        launch: {
          sessionId: started.sessionId,
          workspaceId: started.workspaceId,
          conversationMode: launch.mode,
          provider: started.provider,
          program: launch.program,
          arguments: launch.arguments,
          environment: launch.environment,
          workingDirectory: launch.workingDirectory,
          initialInput: launch.initialInput,
          environmentRemove: launch.environmentRemove,
          ...("transcript" in started ? { transcript: started.transcript } : {}),
        },
      }),
    );
  }

  private fail(id: number, error: unknown): void {
    const details =
      error !== null && typeof error === "object" && "details" in error
        ? (error.details as Record<string, unknown>)
        : {};
    const stage = details.stage;
    this.write(
      JSON.stringify({
        kind: "core.failed",
        id,
        code: errorCode(error),
        ...(typeof stage === "string" ? { stage } : {}),
      }),
    );
  }

  private openDecoder(request: Request): void {
    const decoderId = request.decoderId as string;
    if (!this.decoders.has(decoderId) && this.decoders.size >= MAX_OPEN_DECODERS) {
      this.fail(request.id, { code: "decoder_limit_reached" });
      return;
    }
    try {
      this.decoders.set(decoderId, this.handlers.createDecoder(request.provider as string));
      this.decoded(request.id, []);
    } catch (error) {
      this.fail(request.id, error);
    }
  }

  private decode(request: Request): void {
    const decoderId = request.decoderId as string;
    const decoder = this.decoders.get(decoderId);
    if (request.kind === "decoder.close") {
      this.decoders.delete(decoderId);
      this.decoded(request.id, []);
      return;
    }
    if (decoder === undefined) {
      this.fail(request.id, { code: "decoder_not_found" });
      return;
    }
    if (request.kind === "decoder.send") {
      const sent = decoder.send(request.text as string);
      this.decoded(request.id, sent.events, Buffer.from(sent.input).toString("base64"));
      return;
    }
    this.decoded(request.id, decoder.output(Buffer.from(request.data as string, "base64")));
  }

  private decoded(id: number, events: readonly unknown[], input?: string): void {
    this.write(
      JSON.stringify({
        kind: "decoder.decoded",
        id,
        events,
        ...(input === undefined ? {} : { input }),
      }),
    );
  }
}

/**
 * Splits the input into lines without holding more than one bounded line. A line over the bound
 * yields `null`, which ends the link.
 */
async function* lines(input: AsyncIterable<Uint8Array | string>): AsyncGenerator<string | null> {
  const decoder = new TextDecoder();
  let partial = "";
  for await (const chunk of input) {
    partial += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let end = partial.indexOf("\n");
    while (end !== -1) {
      yield partial.slice(0, end);
      partial = partial.slice(end + 1);
      end = partial.indexOf("\n");
    }
    if (partial.length > MAX_REQUEST_LINE_BYTES) {
      yield null;
      return;
    }
  }
}
