import { create } from "zustand";

import type { MemberLane } from "./room";

interface RoomStore {
  /** The agent whose session leads the open conversation, or null without agents. */
  readonly leadAgentId: string | null;
  /** The sessions of the agents that joined it, by session. */
  readonly members: Readonly<Record<string, MemberLane>>;
  /**
   * The core's code when it could not route the owner's last turn to the agents it mentions; the
   * conversation's lead received the turn instead. Null once a turn routes, or for a new room.
   */
  readonly unrouted: string | null;
}

/** The open conversation's agents beyond its lead (Lervo ADE rooms, "The ADE"). */
export const useRoomStore = create<RoomStore>(() => ({
  leadAgentId: null,
  members: {},
  unrouted: null,
}));
