// The words of an agent's conversation note (Lervo ADE rooms, "Memory from conversation"): a
// leaf, so the session start's recall and the note writer cut notes alike without importing each
// other.

/** The most characters a note keeps. */
export const NOTE_CHARACTERS = 512;

/**
 * The agent's own words in a message: every fenced code block and every quoted line dropped, so a
 * note never carries code, tool output, or another agent's words that the message repeats.
 */
export function ownWords(text: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/u)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence !== null) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length)
        fence = null;
      continue;
    }
    if (marker !== undefined) fence = marker;
    else if (!/^ {0,3}>/u.test(line)) kept.push(line);
  }
  return kept.join("\n");
}

/** Text with its whitespace collapsed, cut at a word within `limit` characters. */
export function clipAtWord(text: string, limit = NOTE_CHARACTERS): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
