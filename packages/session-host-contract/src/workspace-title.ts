/** Characters a workspace title holds at most, its ellipsis included. */
export const WORKSPACE_TITLE_CHARACTERS = 80;

/**
 * A workspace's title: the instruction's first line that has text, its spaces collapsed, shortened
 * at a word. The core titles the workstream with it, and the interface shows the same title while
 * the core creates the workspace, so the header never changes when the workspace arrives.
 */
export function workspaceTitle(instruction: string): string {
  const line =
    instruction
      .split(/\r?\n/u)
      .map((item) => item.replace(/\s+/gu, " ").trim())
      .find((item) => item.length > 0) ?? "";
  if ([...line].length <= WORKSPACE_TITLE_CHARACTERS) return line;
  const cut = [...line].slice(0, WORKSPACE_TITLE_CHARACTERS - 1).join("");
  const word = cut.lastIndexOf(" ");
  return `${(word > WORKSPACE_TITLE_CHARACTERS / 2 ? cut.slice(0, word) : cut).trimEnd()}…`;
}
