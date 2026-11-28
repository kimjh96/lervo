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
/** A code block's line, and its padding: meta type at 12.5 px on 1.4. */
const CODE_LINE_PX = 17.5;
const CODE_PADDING_PX = 24;
/** A table row: a meta line and its cell padding. */
const TABLE_ROW_PX = 30;
const FENCE = /^\s*(?:```|~~~)/u;
const TABLE_RULE = /^\s*\|?[\s:|-]+\|?\s*$/u;

/**
 * The height of markdown text: prose wraps at the column's width, while code blocks and tables
 * keep a line per row in a smaller type, so they count by their own rows. A long code block or
 * table estimated as prose was off by hundreds of pixels.
 */
function textHeight(text: string, charactersPerLine: number): number {
  let height = 0;
  let blocks = 0;
  let inCode = false;
  let previousBlank = true;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) {
      if (!inCode) {
        height += CODE_PADDING_PX;
        blocks += 1;
      }
      inCode = !inCode;
      previousBlank = false;
      continue;
    }
    if (inCode) {
      height += CODE_LINE_PX;
      continue;
    }
    if (line.trim().length === 0) {
      previousBlank = true;
      continue;
    }
    if (previousBlank) blocks += 1;
    previousBlank = false;
    if (line.trimStart().startsWith("|")) {
      height += TABLE_RULE.test(line) ? 0 : TABLE_ROW_PX;
      continue;
    }
    height += Math.max(1, Math.ceil(line.length / charactersPerLine)) * LINE_PX;
  }
  return height + Math.max(0, blocks - 1) * PARAGRAPH_GAP_PX;
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
