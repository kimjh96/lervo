import {
  answersQuestions,
  interruptsTurns,
  reportsUsage,
  sendsImages,
  type HostedDecodedContent,
  type HostedDecodedEvent,
  type HostedSentImage,
  type HostedStreamDecoder,
  type HostedTurnUsage,
} from "@lervo/adapter-contract";
import { validateCoreLinkRequest } from "@lervo/session-host-contract";

import { errorCode } from "./command-error-output.js";
import { commandAnswer, type Started } from "./core-link-commands.js";
import type { CoreLinkHandlers } from "./core-link-handlers.js";
import { lines } from "./core-link-lines.js";
import { RoomLink, roomTranscriptContent } from "./room-link.js";
import type { RoomDelivery } from "./room-router.js";
import { TurnUsageQueue } from "./core-link-usage-queue.js";
import { withoutShellOutput } from "./lervo-command-detail.js";

/** Decoders open at once. Each belongs to one native session of the session host. */
export const MAX_OPEN_DECODERS = 256;
/**
 * Usage records an unnamed decoder holds until the session host names its session. Past this,
 * the oldest are dropped and counted with the queue's drops, never lost silently.
 */
export const MAX_PENDING_TURN_USAGE = 256;

type Request = { kind: string; id: number } & Record<string, unknown>;

export type { CoreLinkHandlers } from "./core-link-handlers.js";

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
  /** The hosted session each decoder serves, when the session host named it. */
  private readonly decoderSessions = new Map<string, string>();
  /** Usage of decoders opened before their session was named, by decoder. */
  private readonly pendingUsage = new Map<string, HostedTurnUsage[]>();
  private readonly pending = new Set<Promise<void>>();
  private readonly rooms: RoomLink;
  readonly usage: TurnUsageQueue;

  constructor(
    private readonly handlers: CoreLinkHandlers,
    private readonly write: (line: string) => void,
  ) {
    this.usage = new TurnUsageQueue((sessionId, accounting, usage) =>
      this.handlers.recordTurnUsage(sessionId, accounting, usage),
    );
    this.rooms = new RoomLink(
      handlers.loadRoomContext,
      (task) => {
        this.pending.add(task);
        void task.finally(() => this.pending.delete(task));
      },
      handlers.pendingStarts,
    );
  }

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
    await this.usage.idle();
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
      case "session.exited":
        this.respond(request.id, () =>
          this.handlers.recordSessionExit(
            request.sessionId as string,
            request.exitCode as number | null,
          ),
        );
        return;
      default:
        this.decode(request);
    }
  }

  /** Commands that start work answer with a launch; list commands answer with their result. */
  private command(request: Request): void {
    const answer = commandAnswer(
      this.handlers,
      request.command as string,
      (request.arguments ?? {}) as Record<string, unknown>,
    );
    if (answer.kind === "result") {
      this.respond(request.id, answer.run);
      return;
    }
    // A joined agent's session is one more place its conversation's mentions reach.
    const joins = request.command === "room.join";
    this.track(request.id, async () => {
      const started = await answer.run();
      if (joins) this.rooms.joined();
      return started;
    });
  }

  private page(request: Request): void {
    const task = this.handlers
      .readTranscript(
        request.workspaceId as string,
        request.offset as number,
        request.limit as number,
      )
      .then(
        (page) =>
          this.write(
            JSON.stringify({
              kind: "transcript.page",
              id: request.id,
              complete: page.complete,
              items: page.items.map((item) => ({
                ...item,
                content: this.annotated(roomTranscriptContent(item.content)),
              })),
            }),
          ),
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
      const existing = this.decoders.get(decoderId);
      if (
        existing !== undefined &&
        typeof request.sessionId === "string" &&
        !this.decoderSessions.has(decoderId)
      ) {
        // The session host names a decoder it opened unnamed: keep it, and record the turns it
        // already decoded. Their coordinates are deterministic, so nothing counts twice.
        this.decoderSessions.set(decoderId, request.sessionId);
        this.rooms.opened(decoderId, request.sessionId, request.deliveries === true);
        const pending = this.pendingUsage.get(decoderId) ?? [];
        this.pendingUsage.delete(decoderId);
        if (pending.length > 0 && reportsUsage(existing))
          this.usage.push(request.sessionId, existing.usageAccounting(), pending);
        this.decoded(request.id, []);
        return;
      }
      this.decoders.set(decoderId, this.handlers.createDecoder(request.provider as string));
      this.pendingUsage.delete(decoderId);
      if (typeof request.sessionId === "string") {
        this.decoderSessions.set(decoderId, request.sessionId);
        this.rooms.opened(decoderId, request.sessionId, request.deliveries === true);
      } else this.decoderSessions.delete(decoderId);
      this.decoded(request.id, []);
    } catch (error) {
      this.fail(request.id, error);
    }
  }

  private decode(request: Request): void {
    const decoderId = request.decoderId as string;
    const decoder = this.decoders.get(decoderId);
    if (request.kind === "decoder.close") {
      this.rooms.closed(decoderId, this.decoderSessions.get(decoderId));
      this.decoders.delete(decoderId);
      this.decoderSessions.delete(decoderId);
      this.pendingUsage.delete(decoderId);
      this.decoded(request.id, []);
      return;
    }
    if (decoder === undefined) {
      this.fail(request.id, { code: "decoder_not_found" });
      return;
    }
    if (request.kind === "decoder.send") {
      const text = request.text as string;
      const images = request.images as readonly HostedSentImage[] | undefined;
      let sent: ReturnType<HostedStreamDecoder["send"]>;
      if (images === undefined) sent = decoder.send(text);
      else if (sendsImages(decoder)) sent = decoder.sendWithImages(text, images);
      else {
        this.fail(request.id, { code: "images_unsupported" });
        return;
      }
      const shown = this.rooms.sent(
        decoderId,
        this.decoderSessions.get(decoderId),
        request.deliveryId as string | undefined,
        sent.events,
      );
      this.decoded(request.id, shown, Buffer.from(sent.input).toString("base64"));
      return;
    }
    if (request.kind === "decoder.answer") {
      if (!answersQuestions(decoder)) {
        this.fail(request.id, { code: "questions_unsupported" });
        return;
      }
      const answered = decoder.answer(
        request.requestId as string,
        request.answers as Record<string, string>,
      );
      if (answered.input.length === 0) {
        this.fail(request.id, { code: "question_not_open" });
        return;
      }
      this.decoded(request.id, answered.events, Buffer.from(answered.input).toString("base64"));
      return;
    }
    if (request.kind === "decoder.interrupt") {
      if (!interruptsTurns(decoder)) {
        this.fail(request.id, { code: "interrupt_unsupported" });
        return;
      }
      const stopping = decoder.interrupt();
      this.decoded(request.id, stopping.events, Buffer.from(stopping.input).toString("base64"));
      return;
    }
    const routed = this.rooms.output(
      decoderId,
      this.decoderSessions.get(decoderId),
      decoder.output(Buffer.from(request.data as string, "base64")),
    );
    const replies = answersQuestions(decoder) ? decoder.takeReplies() : new Uint8Array();
    this.decoded(
      request.id,
      routed.events,
      replies.length === 0 ? undefined : Buffer.from(replies).toString("base64"),
      routed.deliveries,
    );
    // Usage leaves the decoder after the events are answered: to the queue for a named session,
    // and held, bounded, for one the session host has not named yet.
    if (!reportsUsage(decoder)) return;
    const usage = decoder.takeUsage();
    if (usage.length === 0) return;
    const sessionId = this.decoderSessions.get(decoderId);
    if (sessionId !== undefined) {
      this.usage.push(sessionId, decoder.usageAccounting(), usage);
      return;
    }
    const pending = [...(this.pendingUsage.get(decoderId) ?? []), ...usage];
    const overflow = Math.max(0, pending.length - MAX_PENDING_TURN_USAGE);
    this.usage.dropped += overflow;
    this.pendingUsage.set(decoderId, pending.slice(overflow));
  }

  private decoded(
    id: number,
    events: readonly HostedDecodedEvent[],
    input?: string,
    deliveries?: readonly RoomDelivery[],
  ): void {
    this.write(
      JSON.stringify({
        kind: "decoder.decoded",
        id,
        events: events.map((event) =>
          event.kind === "item" || event.kind === "start"
            ? { ...event, content: this.annotated(event.content) }
            : event,
        ),
        ...(input === undefined ? {} : { input }),
        ...(deliveries === undefined || deliveries.length === 0 ? {} : { deliveries }),
      }),
    );
  }

  /** The item as the session host receives it: annotated, and never with a shell output. */
  private annotated(content: HostedDecodedContent): HostedDecodedContent {
    return withoutShellOutput(this.handlers.annotate?.(content) ?? content);
  }
}
