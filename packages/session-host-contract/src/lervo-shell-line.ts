// How a hosted session's shell line reads as Lervo's own work (ADE session-host protocol, "Tool
// detail"). The core adds the line's Lervo call to its detail, and the interface reads the line's
// other commands by the same rule, so the two always split a line alike.
import type { ToolDetail } from "./tool-detail.js";

export type LervoCall = NonNullable<ToolDetail["lervo"]>;

/** A shell line's Lervo call, and the commands it also ran that are not Lervo's. */
export interface LervoShellLine {
  readonly call: LervoCall;
  /** The line's other commands as it spells them, joined by their operators. */
  readonly others?: string;
}

interface Token {
  readonly text: string;
  readonly quoted: boolean;
}

interface Segment {
  /** The control operator before the segment; empty for the first. */
  readonly operator: string;
  readonly words: readonly Token[];
  /** The segment as the line spells it. */
  readonly source: string;
}

const WORD = /^[a-z][a-z0-9-]*$/u;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const MAX_COMMAND_WORDS = 6;
const MAX_TEXT_CHARACTERS = 512;
/** Commands that only move into a directory for the commands after them. */
const PRELUDE = new Set(["cd", "pushd"]);
/** Commands that only print a message, such as a separator, and do no work of their own. */
const MESSAGES = new Set(["echo", "true", "printf"]);
/** How a kept command joins the one before it. */
const JOINS: Readonly<Record<string, string>> = { "&&": " && ", "||": " || " };

/**
 * The words and control operators of a shell line, with quotes removed. A quoted part marks its
 * word as quoted. An unclosed quote runs to the end, as a shortened command's might.
 */
function segments(line: string): Segment[] {
  const result: Segment[] = [];
  let words: Token[] = [];
  let operator = "";
  let start = 0;
  let word = "";
  let quoted = false;
  let started = false;
  const endWord = () => {
    if (started) words.push({ text: word, quoted });
    word = "";
    quoted = false;
    started = false;
  };
  const endSegment = (end: number, next: string) => {
    endWord();
    result.push({ operator, words, source: line.slice(start, end).trim() });
    words = [];
    operator = next;
    start = end + next.length;
  };
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] as string;
    const next = line[index + 1];
    if (character === "'" || character === '"') {
      const close = line.indexOf(character, index + 1);
      const end = close === -1 ? line.length : close;
      let part = line.slice(index + 1, end);
      if (character === '"') part = part.replaceAll(/\\(["\\$`])/gu, "$1");
      word += part;
      quoted = true;
      started = true;
      index = end;
    } else if (character === "\\" && next !== undefined) {
      if (next !== "\n") word += next;
      started = started || next !== "\n";
      index += 1;
    } else if (character === "\n" || character === ";") {
      endSegment(index, ";");
    } else if ((character === "&" || character === "|") && next === character) {
      endSegment(index, character + character);
      index += 1;
    } else if (character === "|") {
      endSegment(index, "|");
    } else if (character === "&" && !started) {
      endSegment(index, "&");
    } else if (character === " " || character === "\t") {
      endWord();
    } else {
      word += character;
      started = true;
    }
  }
  endSegment(line.length, "");
  return result.filter((segment) => segment.words.length > 0);
}

/** A command and the filters its output is piped into, as the line spells them. */
interface Pipeline {
  readonly operator: string;
  /** The command's words, without the variables it assigns first. */
  readonly words: readonly Token[];
  readonly source: string;
}

function pipelines(line: string): Pipeline[] {
  const result: Pipeline[] = [];
  for (const segment of segments(line)) {
    const last = result.at(-1);
    if (segment.operator === "|" && last !== undefined) {
      result[result.length - 1] = { ...last, source: `${last.source} | ${segment.source}` };
      continue;
    }
    const words = [...segment.words];
    while (words.length > 0 && !words[0]!.quoted && ASSIGNMENT.test(words[0]!.text)) words.shift();
    result.push({ operator: segment.operator, words, source: segment.source });
  }
  return result;
}

const isLervo = (token: Token | undefined) =>
  token !== undefined && token.text.split("/").at(-1) === "lervo";

const named = (token: Token | undefined, names: ReadonlySet<string>) =>
  token !== undefined && !token.quoted && names.has(token.text);

/** `text` within `characters`, ending in an ellipsis when it is shortened. */
export function shortenedText(text: string, characters = MAX_TEXT_CHARACTERS): string {
  const units = [...text.trim()];
  return units.length <= characters
    ? units.join("")
    : `${units.slice(0, characters - 1).join("")}…`;
}

/** The call `arguments_` make: the longest command path the catalog knows, a flag, a subject. */
function call(arguments_: readonly Token[], commands: ReadonlySet<string>): LervoCall {
  const words: string[] = [];
  for (const token of arguments_) {
    if (token.quoted || !WORD.test(token.text) || words.length === MAX_COMMAND_WORDS) break;
    words.push(token.text);
  }
  let length = words.length;
  while (length > 0 && !commands.has(words.slice(0, length).join(" "))) length -= 1;
  // A command the catalog does not know, such as a newer CLI's, keeps its first word.
  const command = words.slice(0, length === 0 ? Math.min(1, words.length) : length).join(" ");
  const flagged = (...names: string[]) =>
    arguments_.some((token) => !token.quoted && names.includes(token.text));
  const flag =
    command === "" && flagged("--version") ? "version" : flagged("--help", "-h") ? "help" : null;
  // The subject is the first quoted positional argument, such as a query: never a flag's value
  // or a JSON document.
  const subject = arguments_.find((token, index) => {
    const before = arguments_[index - 1];
    const text = token.text.trim();
    return (
      index >= length &&
      token.quoted &&
      text.length > 0 &&
      !/^[{[]/u.test(text) &&
      (before === undefined || before.quoted || !before.text.startsWith("-"))
    );
  });
  return {
    command,
    ...(flag === null ? {} : { flag }),
    ...(subject === undefined ? {} : { subject: shortenedText(subject.text) }),
  };
}

/**
 * The Lervo call a shell line makes, or undefined when it runs no `lervo` command. The line's
 * first Lervo call is its call; later ones, the filters their output is piped into, and messages
 * such as a separator belong to it. Every other command is the line's own, kept in `others` as
 * the line spells it, with a directory change before it.
 */
export function readLervoShellLine(
  line: string,
  commands: ReadonlySet<string>,
): LervoShellLine | undefined {
  let found: LervoCall | undefined;
  const others: string[] = [];
  const moves: string[] = [];
  const keep = (pipeline: Pipeline) =>
    others.push(
      others.length === 0
        ? pipeline.source
        : `${JOINS[pipeline.operator] ?? "; "}${pipeline.source}`,
    );
  for (const pipeline of pipelines(line)) {
    const first = pipeline.words[0];
    if (first === undefined || named(first, MESSAGES)) continue;
    if (isLervo(first)) found ??= call(pipeline.words.slice(1), commands);
    else if (named(first, PRELUDE)) moves.push(pipeline.source);
    else {
      // A directory change matters only to the commands after it.
      for (const move of moves.splice(0))
        keep({ operator: others.length === 0 ? "" : ";", words: [], source: move });
      keep(pipeline);
    }
  }
  if (found === undefined) return undefined;
  return others.length === 0
    ? { call: found }
    : { call: found, others: shortenedText(others.join("")) };
}
