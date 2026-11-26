// The sessions of the agents that joined the open conversation (Lervo ADE rooms, "The ADE").
import type { HostMessage } from "@lervo/session-host-contract";

import { type ApplicationCommands, RequestFailure, type SessionHost } from "../../../ports";
import type { MemberLane } from "./room";
import { useRoomStore } from "./room-store";
import { applyAppended, applyDelta, applyPage, emptyWindow, PAGE_ITEMS } from "./window";

/** One agent's session in the conversation. */
export interface RoomMember {
  readonly agentId: string;
  readonly sessionId: string;
}

/** How often, and how many times, a member that the core reopens is looked for. */
const REOPEN_POLL_MS = 300;
const REOPEN_POLLS = 20;

/**
 * Follows each joined agent's own session: its newest page, then its live items. A member whose
 * session does not run, such as after the session host restarted, reopens through `room.join`,
 * which resumes the agent's session beside the lead.
 */
export class RoomMembers {
  private readonly unsubscribe: (() => void)[] = [];
  private readonly members = new Map<string, RoomMember>();
  private closed = false;

  constructor(
    private readonly client: SessionHost,
    private readonly commands: ApplicationCommands,
    private readonly workspaceId: string,
    leadAgentId: string | null,
  ) {
    useRoomStore.setState({ leadAgentId, members: {} });
    this.unsubscribe.push(this.client.onMessage((message) => this.receive(message)));
  }

  /** Follows `member`, once, from its newest page on. */
  follow(member: RoomMember): void {
    if (this.closed || this.members.has(member.sessionId)) return;
    this.members.set(member.sessionId, member);
    void this.load(member);
  }

  /** The joined agent's running session, when it has one. */
  sessionOf(agentId: string): string | undefined {
    for (const member of this.members.values())
      if (member.agentId === agentId) return member.sessionId;
    return undefined;
  }

  close(): void {
    this.closed = true;
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    for (const sessionId of this.members.keys())
      void this.client.send({ kind: "session.detach", sessionId }).catch(() => undefined);
    useRoomStore.setState({ leadAgentId: null, members: {} });
  }

  private lane(member: RoomMember, update: (lane: MemberLane) => MemberLane): void {
    if (this.closed) return;
    const members = useRoomStore.getState().members;
    const lane = members[member.sessionId] ?? { ...member, window: emptyWindow };
    useRoomStore.setState({ members: { ...members, [member.sessionId]: update(lane) } });
  }

  private async load(member: RoomMember): Promise<void> {
    // A session the session host is starting, such as one that just joined, appears shortly.
    if (await this.attachWithin(member, REOPEN_POLLS / 4)) return;
    // Otherwise the core resumes the agent's session beside the lead, and the host starts it.
    await this.commands
      .run("room.join", { workspaceId: this.workspaceId, agentId: member.agentId })
      .catch(() => undefined);
    await this.attachWithin(member, REOPEN_POLLS);
  }

  /** Attaches within `polls` tries, waiting between them while the session is not found. */
  private async attachWithin(member: RoomMember, polls: number): Promise<boolean> {
    for (let poll = 0; poll < polls && !this.closed; poll += 1) {
      try {
        await this.attach(member);
        return true;
      } catch (failure) {
        if (!(failure instanceof RequestFailure) || failure.code !== "session_not_found")
          return false;
        await new Promise((resolve) => setTimeout(resolve, REOPEN_POLL_MS));
      }
    }
    return false;
  }

  private async attach(member: RoomMember): Promise<void> {
    await this.client.post({
      kind: "session.attach",
      sessionId: member.sessionId,
      afterSequence: 0,
    });
    const page = await this.client.request({
      kind: "conversation.range",
      sessionId: member.sessionId,
      direction: "before",
      limit: PAGE_ITEMS,
    });
    if (page.kind !== "conversation.page") throw new RequestFailure("range_invalid");
    this.lane(member, (lane) => ({ ...lane, window: applyPage(emptyWindow, page, "latest") }));
  }

  private receive(message: HostMessage): void {
    if (!("sessionId" in message)) return;
    const member = this.members.get(message.sessionId);
    if (member === undefined) return;
    if (message.kind === "session.resync_required") void this.load(member);
    else if (message.kind === "conversation.delta")
      this.lane(member, (lane) => ({
        ...lane,
        window: applyDelta(lane.window, message.itemId, message.append),
      }));
    else if (message.kind === "conversation.appended")
      this.lane(member, (lane) => ({ ...lane, window: applyAppended(lane.window, message.items) }));
  }
}
