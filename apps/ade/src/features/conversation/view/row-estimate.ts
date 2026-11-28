import type { ConversationItem } from "@lervo/session-host-contract";

/**
 * A row's height before it is measured, close enough that history mounting above the reader moves
 * the view by little when its measured height corrects the estimate (ADE motion, "Following the
 * stream"). A flat guess was off by hundreds of pixels for long replies and short tool lines, and
 * the view jumped by that much as each earlier page settled (2026-11-28). The numbers follow the
 * conversation column: about 90 characters to a line of body text 25 pixels high.
 */
const CHARACTERS_PER_LINE = 90;
const LINE_PX = 25;
const PARAGRAPH_GAP_PX = 12;
const ROW_PADDING_PX = 20;
const META_ROW_PX = 30;
const FALLBACK_PX = 72;

function textHeight(text: string, charactersPerLine: number): number {
  const paragraphs = text.split(/\n{2,}/u);
  const lines = paragraphs.reduce(
    (total, paragraph) =>
      total +
      paragraph
        .split("\n")
        .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0),
    0,
  );
  return lines * LINE_PX + (paragraphs.length - 1) * PARAGRAPH_GAP_PX;
}

export function estimatedRowHeight(item: ConversationItem | undefined): number {
  if (item === undefined) return FALLBACK_PX;
  switch (item.kind) {
    case "tool_activity":
    case "lervo_notice":
      return META_ROW_PX;
    case "agent_message":
    case "peer_message":
    case "question":
      return ROW_PADDING_PX + textHeight(item.text, CHARACTERS_PER_LINE);
    case "user_message":
      // The bubble is narrower than the column and padded.
      return ROW_PADDING_PX * 2 + textHeight(item.text, CHARACTERS_PER_LINE * 0.75);
    default:
      return FALLBACK_PX;
  }
}
