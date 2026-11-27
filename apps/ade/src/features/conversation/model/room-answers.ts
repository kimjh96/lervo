// What the conversation's lead answered elsewhere (Lervo ADE rooms, "Mentioning across
// conversations"): each mention delivered to it in another conversation shows here as one quiet
// line, "Ciel answered Iris in Log format", at the time of the delivery.
import type { ConversationItem, RoomAnswersResult } from "@lervo/session-host-contract";

import type { ApplicationCommands } from "../../../ports";
import { useRoomStore } from "./room-store";
import type { ConversationWindow } from "./window";

export type RoomAnswer = RoomAnswersResult["answers"][number];

/** One quiet line per answer, named for the lead and the agent it answered. */
export function answerItems(
  answers: readonly RoomAnswer[],
  leadName: string,
  nameOf: (agentId: string) => string | null,
): ConversationItem[] {
  return answers.map((answer) => ({
    kind: "lervo_notice",
    itemId: `answer-${answer.mentionId}`,
    createdAtMs: Date.parse(answer.deliveredAt),
    state: "complete",
    code: "room_answered_elsewhere",
    parameters: {
      agent: leadName,
      from: nameOf(answer.fromAgentId) ?? "",
      workspace: answer.workspaceId,
    },
  }));
}

/**
 * The timeline with the answers placed at their times. An answer older than the window's first
 * item waits until earlier pages reach it, and one newer than its last waits for later pages, so
 * pages stay in order. The timeline's own items stay as they are.
 */
export function withAnswers(
  window: ConversationWindow,
  answers: readonly ConversationItem[],
): ConversationWindow {
  const first = window.items[0]?.createdAtMs;
  const last = window.items.at(-1)?.createdAtMs;
  const placed = answers.filter(
    (answer) =>
      (!window.hasEarlier || first === undefined || answer.createdAtMs >= first) &&
      (!window.hasLater || last === undefined || answer.createdAtMs <= last),
  );
  if (placed.length === 0) return window;
  const items = [...window.items, ...placed].toSorted(
    (left, right) => left.createdAtMs - right.createdAtMs,
  );
  return { ...window, items };
}

/**
 * Reads the lead's answers elsewhere through the core's `room.answers` and keeps them as lines.
 * A failed read keeps the lines shown; an answer for a conversation the view left is dropped.
 */
export async function loadRoomAnswers(
  commands: ApplicationCommands,
  workspaceId: string,
  leadName: string,
  nameOf: (agentId: string) => string | null,
  current: () => boolean,
): Promise<void> {
  try {
    const { answers } = await commands.run("room.answers", { workspaceId });
    if (current()) useRoomStore.setState({ answers: answerItems(answers, leadName, nameOf) });
  } catch {
    // The lines already shown stay; the next turn's end reads again.
  }
}
