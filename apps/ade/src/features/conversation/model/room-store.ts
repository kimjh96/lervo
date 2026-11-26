import { create } from "zustand";

import type { MemberLane } from "./room";

interface RoomStore {
  /** The agent whose session leads the open conversation, or null without agents. */
  readonly leadAgentId: string | null;
  /** The sessions of the agents that joined it, by session. */
  readonly members: Readonly<Record<string, MemberLane>>;
}

/** The open conversation's agents beyond its lead (Lervo ADE rooms, "The ADE"). */
export const useRoomStore = create<RoomStore>(() => ({ leadAgentId: null, members: {} }));
