// The core link's side of rooms: which decoders route, and what their answers carry.
import type { HostedDecodedContent, HostedDecodedEvent } from "@lervo/adapter-contract";

import { ClaimLines } from "./claim-lines.js";
import { readEnvelope } from "./room-envelope.js";
import type { ConversationNote } from "./conversation-notes.js";
import type { RoomEvent } from "./room-events.js";
import { RoomRouter, type RoomContext, type RoomDelivery } from "./room-router.js";
import type { PendingStart } from "./room-starts.js";

/** Opened conversations remembered so a start opens once; far more than starts can wait. */
const OPENED_KEPT = 64;

/**
 * Routes the decoders the session host opened with `deliveries` (Lervo ADE rooms, "The core link
 * and the session host"). A decoder opened without it answers exactly as before, so an older
 * session host never receives a field it does not know.
 */
export class RoomLink {
  private readonly router: RoomRouter;
  private readonly delivering = new Set<string>();
  private readonly sessions = new Map<string, string>();
  /** Each agent's pending starts, as last read: the file is read off the decoder's path. */
  private readonly starts = new Map<string, readonly PendingStart[]>();
  /** Conversations whose opening delivery went out, so a start opens once. */
  private readonly startsOpened = new Set<string>();

  constructor(
    private readonly load: ((sessionId: string) => Promise<RoomContext | null>) | undefined,
    private readonly track: (task: Promise<void>) => void,
    private readonly loadStarts?: (agentId: string) => Promise<readonly PendingStart[]>,
    private readonly claims: ClaimLines = new ClaimLines(),
    /** Keeps the room's records in its repository; absent, the room records nothing. */
    recordEvents?: (repositoryRoot: string, events: readonly RoomEvent[]) => Promise<unknown>,
    /** Writes an agent's note after a turn a mention delivered; absent, no note is written. */
    writeNote?: (note: ConversationNote) => Promise<unknown>,
  ) {
    // Records and notes go out off the decoder's path, and a failed one changes nothing here.
    const background = (work: Promise<unknown>) =>
      this.track(
        work.then(
          () => undefined,
          () => undefined,
        ),
      );
    this.router = new RoomRouter(
      undefined,
      undefined,
      (root, events) => {
        if (recordEvents !== undefined) background(recordEvents(root, events));
      },
      (note) => {
        if (writeNote !== undefined) background(writeNote(note));
      },
    );
  }

  /** A decoder the session host opened or named; it routes when the host performs deliveries. */
  opened(decoderId: string, sessionId: string | undefined, deliveries: boolean): void {
    if (sessionId === undefined || !deliveries) return;
    this.delivering.add(decoderId);
    this.sessions.set(sessionId, decoderId);
    this.refresh(sessionId);
  }

  closed(decoderId: string, sessionId: string | undefined): void {
    this.delivering.delete(decoderId);
    if (sessionId === undefined) return;
    this.sessions.delete(sessionId);
    this.router.forget(sessionId);
    this.claims.forget(sessionId);
  }

  /** Reloads every routed session's conversation after an agent joined it. */
  joined(): void {
    for (const sessionId of this.sessions.keys()) this.refresh(sessionId);
  }

  private refresh(sessionId: string): void {
    const load = this.load;
    if (load === undefined) return;
    // A conversation that fails to load routes nothing; its sessions still answer.
    this.track(
      load(sessionId).then(
        (context) => {
          if (context !== null && this.sessions.has(sessionId)) {
            this.router.know(sessionId, context);
            this.refreshStarts(context.agentId);
          }
        },
        () => undefined,
      ),
    );
  }

  /** Rereads an agent's pending starts; a failed read keeps the last one. */
  private refreshStarts(agentId: string): void {
    const loadStarts = this.loadStarts;
    if (loadStarts === undefined) return;
    this.track(
      loadStarts(agentId).then(
        (starts) => void this.starts.set(agentId, starts),
        () => undefined,
      ),
    );
  }

  sent(
    decoderId: string,
    sessionId: string | undefined,
    deliveryId: string | undefined,
    events: readonly HostedDecodedEvent[],
  ): readonly HostedDecodedEvent[] {
    if (sessionId === undefined || !this.delivering.has(decoderId)) return events;
    // Each turn rereads its conversation, so an agent paused or retired since, by the interface
    // or the terminal, is no longer mentioned when this turn ends.
    this.refresh(sessionId);
    return this.router.sent(sessionId, deliveryId, events);
  }

  output(
    decoderId: string,
    sessionId: string | undefined,
    events: readonly HostedDecodedEvent[],
  ): { events: readonly HostedDecodedEvent[]; deliveries?: RoomDelivery[] } {
    if (sessionId === undefined || !this.delivering.has(decoderId)) return { events };
    const observed = this.router.observe(sessionId, events);
    const agentId = this.router.agentOf(sessionId);
    // The lines of the claims Lervo stopped or deferred follow the calls they concern.
    const routed = {
      ...observed,
      events: this.claims.annotate(sessionId, agentId, observed.events, (id) =>
        this.router.nameOf(sessionId, id),
      ),
    };
    if (agentId === null) return routed;
    // A start is recorded by a command the agent runs, so its tool line is the cue to reread.
    if (events.some((event) => event.kind === "item" && event.content.kind === "tool_activity"))
      this.refreshStarts(agentId);
    const ended = events.some(
      (event) => event.kind === "status" && event.event === "turn_finished",
    );
    const waiting = (this.starts.get(agentId) ?? []).filter(
      (start) => !this.startsOpened.has(start.workspaceId),
    );
    if (!ended || waiting.length === 0) return routed;
    for (const start of waiting) this.startsOpened.add(start.workspaceId);
    if (this.startsOpened.size > OPENED_KEPT)
      for (const workspaceId of [...this.startsOpened].slice(
        0,
        this.startsOpened.size - OPENED_KEPT,
      ))
        this.startsOpened.delete(workspaceId);
    const started = this.router.starts(sessionId, waiting);
    return {
      events: [...routed.events, ...started.events],
      deliveries: [...routed.deliveries, ...started.deliveries],
    };
  }
}

/** A transcript item as a conversation shows it: a delivered turn reads as its sender's message. */
export function roomTranscriptContent(content: HostedDecodedContent): HostedDecodedContent {
  if (content.kind !== "user_message") return content;
  const read = readEnvelope(content.text);
  return read === null ? content : { kind: "peer_message", from: read.from, text: read.message };
}
