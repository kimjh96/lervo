// The core link's side of rooms: which decoders route, and what their answers carry.
import type { HostedDecodedContent, HostedDecodedEvent } from "@lervo/adapter-contract";

import { readEnvelope } from "./room-envelope.js";
import { RoomRouter, type RoomContext, type RoomDelivery } from "./room-router.js";

/**
 * Routes the decoders the session host opened with `deliveries` (Lervo ADE rooms, "The core link
 * and the session host"). A decoder opened without it answers exactly as before, so an older
 * session host never receives a field it does not know.
 */
export class RoomLink {
  private readonly router = new RoomRouter();
  private readonly delivering = new Set<string>();
  private readonly sessions = new Map<string, string>();

  constructor(
    private readonly load: ((sessionId: string) => Promise<RoomContext | null>) | undefined,
    private readonly track: (task: Promise<void>) => void,
  ) {}

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
          if (context !== null && this.sessions.has(sessionId))
            this.router.know(sessionId, context);
        },
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
    return this.router.sent(sessionId, deliveryId, events);
  }

  output(
    decoderId: string,
    sessionId: string | undefined,
    events: readonly HostedDecodedEvent[],
  ): { events: readonly HostedDecodedEvent[]; deliveries?: RoomDelivery[] } {
    if (sessionId === undefined || !this.delivering.has(decoderId)) return { events };
    return this.router.observe(sessionId, events);
  }
}

/** A transcript item as a conversation shows it: a delivered turn reads as its sender's message. */
export function roomTranscriptContent(content: HostedDecodedContent): HostedDecodedContent {
  if (content.kind !== "user_message") return content;
  const read = readEnvelope(content.text);
  return read === null ? content : { kind: "peer_message", from: read.from, text: read.message };
}
