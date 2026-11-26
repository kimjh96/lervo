// The agents' questions with choices in one timeline (Lervo ADE sessions, "Questions").
import type { Choices, ConversationItem } from "@lervo/session-host-contract";

/**
 * The session an item of the timeline came from: a joined agent's, whose items the room names
 * `<sessionId>:<itemId>`, or the lead's, as the empty string.
 */
export function laneOf(itemId: string): string {
  const at = itemId.indexOf(":");
  return at === -1 ? "" : itemId.slice(0, at);
}

/**
 * The questions with choices that still wait for the person: each is the last item its session
 * shows. Once the person answers, replies in a message, or the turn ends, the session shows
 * something after it. A window that does not reach the end opens none.
 */
export function openQuestions(
  items: readonly ConversationItem[],
  reachesEnd: boolean,
): ReadonlySet<string> {
  if (!reachesEnd) return new Set();
  const last = new Map<string, ConversationItem>();
  for (const item of items) last.set(laneOf(item.itemId), item);
  return new Set(
    [...last.values()]
      .filter((item) => item.kind === "question" && item.choices !== undefined)
      .map((item) => item.itemId),
  );
}

/**
 * The answers to send, each question's chosen labels by its text, several joined by ", " as the
 * provider reads them; null while a question has none chosen.
 */
export function answersOf(
  choices: Choices,
  chosen: ReadonlyMap<number, readonly string[]>,
): Record<string, string> | null {
  const answers: Record<string, string> = {};
  for (const [index, question] of choices.questions.entries()) {
    const labels = chosen.get(index) ?? [];
    if (labels.length === 0) return null;
    answers[question.question] = labels.join(", ");
  }
  return answers;
}

/** The choice after toggling `label` of a question: one label, or several when it allows them. */
export function toggled(
  current: readonly string[],
  label: string,
  multiSelect: boolean,
): readonly string[] {
  if (!multiSelect) return [label];
  return current.includes(label)
    ? current.filter((chosen) => chosen !== label)
    : [...current, label];
}
