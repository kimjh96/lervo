/**
 * ADR-0562 name mentions in one Markdown document, including fenced code:
 *
 * - `package`: `@lervo/<name>`, anywhere. Always strong: the scope makes the name unambiguous.
 * - `command`: `lervo` followed by up to six lowercase command words, ending at a flag, placeholder,
 *   or punctuation. Strong in inline or fenced code, weak in prose. Resolution against the command
 *   catalog happens when the web is indexed.
 * - `adr`: a bare `ADR-NNNN` outside link syntax. Always weak: a mention, not a declaration.
 *
 * Each distinct mention is reported once, at its first line.
 */
export type RelationMentionKind = "package" | "command" | "adr";

export interface RelationMention {
  kind: RelationMentionKind;
  /** `@lervo/x`, `lervo a b`, or a four-digit ADR number. */
  name: string;
  line: number;
  strong: boolean;
}

const MAXIMUM_COMMAND_WORDS = 6;
const fencePattern = /^\s{0,3}(`{3,}|~{3,})/u;
const inlineCodePattern = /(`+)([^`]+?)\1(?!`)/gu;
const linkPattern = /\[(?:[^\]\\]|\\.)*\]\([^)]*\)/gu;
const packagePattern = /(?<![A-Za-z0-9_.-])@lervo\/([a-z0-9][a-z0-9-]*)/gu;
const commandPattern = /(?<![A-Za-z0-9_./@-])lervo((?: [a-z][a-z0-9-]*)+)/gu;
const adrPattern = /\bADR-(\d{3,5})\b/gu;

function commandWords(match: string): string {
  return ["lervo", ...match.trim().split(" ").slice(0, MAXIMUM_COMMAND_WORDS)].join(" ");
}

export function extractRelationMentions(content: string): RelationMention[] {
  const mentions = new Map<string, RelationMention>();
  const add = (mention: RelationMention) => {
    const key = `${mention.kind}\u0000${mention.name}`;
    const previous = mentions.get(key);
    if (previous === undefined) mentions.set(key, mention);
    else if (mention.strong && !previous.strong) previous.strong = true;
  };
  const scan = (text: string, line: number, code: boolean) => {
    for (const match of text.matchAll(packagePattern))
      add({ kind: "package", name: `@lervo/${match[1]!}`, line, strong: true });
    for (const match of text.matchAll(commandPattern))
      add({ kind: "command", name: commandWords(match[1]!), line, strong: code });
    if (code) return;
    for (const match of text.replace(linkPattern, " ").matchAll(adrPattern))
      add({ kind: "adr", name: match[1]!.padStart(4, "0"), line, strong: false });
  };
  let fence: string | null = null;
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!;
    const line = index + 1;
    const fenceMatch = fencePattern.exec(text);
    if (fence !== null) {
      if (fenceMatch !== null && fenceMatch[1]!.startsWith(fence)) fence = null;
      else scan(text, line, true);
      continue;
    }
    if (fenceMatch !== null) {
      fence = fenceMatch[1]!;
      continue;
    }
    const prose = text.replace(inlineCodePattern, (_match, _ticks, code: string) => {
      scan(code, line, true);
      return " ";
    });
    scan(prose, line, false);
  }
  return [...mentions.values()];
}
