// The sessions of the agents that joined the open conversation (Lervo ADE rooms, "The ADE").
import type { HostMessage } from "@lervo/session-host-contract";

import {
  type ApplicationCommands,
  failureCode,
  RequestFailure,
  type SessionHost,
} from "../../../ports";
import { useWorkspaceStore } from "../../workspaces/model";
import type { MemberLane } from "./room";
import { useRoomStore } from "./room-store";
import { applyAppended, applyDelta, applyPage, emptyWindow, PAGE_ITEMS } from "./window";

/** One agent's session in the conversation. */
export interface RoomMember {
  readonly agentId: string;
  readonly sessionId: string;
}

/** How long a member's session may take to start once the core reopened it. */
const START_WAIT_MS = 6_000;

/** Whether the session host reports the session running: known, and not ended. */
function running(sessionId: string): boolean {
  const status = useWorkspaceStore.getState().statuses[sessionId];
  return status !== undefined && status !== "ended";
}

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
    /** Waits; injected, so tests and an idle window never depend on real timers. */
    private readonly schedule: (run: () => void, ms: number) => () => void = (run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  ) {
    useRoomStore.setState({ leadAgentId, members: {}, unrouted: null });
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
    useRoomStore.setState({ leadAgentId: null, members: {}, unrouted: null });
  }

  private lane(member: RoomMember, update: (lane: MemberLane) => MemberLane): void {
    if (this.closed) return;
    const members = useRoomStore.getState().members;
    const lane = members[member.sessionId] ?? { ...member, window: emptyWindow };
    useRoomStore.setState({ members: { ...members, [member.sessionId]: update(lane) } });
  }

  /**
   * Attaches to the member's session. A session that does not run, such as after the session
   * host restarted or stopped it while idle, is resumed by the core through `room.join`; the
   * host's status report says when it runs. A failure shows as a room line, never silently.
   */
  private async load(member: RoomMember): Promise<void> {
    try {
      // A running session attaches at once, even before its status report arrives.
      if (await this.attached(member)) return;
      await this.commands.run("room.join", {
        workspaceId: this.workspaceId,
        agentId: member.agentId,
      });
      await this.started(member.sessionId);
      await this.attach(member);
    } catch (failure) {
      this.failed(member, failureCode(failure));
    }
  }

  /** Attaches when the session runs; false when the session host has none. */
  private async attached(member: RoomMember): Promise<boolean> {
    try {
      await this.attach(member);
      return true;
    } catch (failure) {
      if (failure instanceof RequestFailure && failure.code === "session_not_found") return false;
      throw failure;
    }
  }

  /** Resolves once the session host reports the session running; rejects after the wait. */
  private started(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (running(sessionId)) return resolve();
      const stop = useWorkspaceStore.subscribe(() => {
        if (!running(sessionId)) return;
        stop();
        cancel();
        resolve();
      });
      const cancel = this.schedule(() => {
        stop();
        reject(new RequestFailure("session_not_found"));
      }, START_WAIT_MS);
    });
  }

  /** Shows in the member's lane that its session could not reopen, with the failure's code. */
  private failed(member: RoomMember, code: string): void {
    this.lane(member, (lane) => ({
      ...lane,
      window: applyAppended(lane.window, [
        {
          kind: "lervo_notice",
          itemId: "rejoin-failed",
          createdAtMs: Date.now(),
          state: "complete",
          code: "room_rejoin_failed",
          parameters: { code },
        },
      ]),
    }));
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
