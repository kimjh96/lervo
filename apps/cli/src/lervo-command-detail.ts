// The core recognizes its own CLI in a hosted session's shell calls (ADE session-host protocol,
// "Tool detail"), so the conversation shows what Lervo did instead of a raw `lervo …` command.
// Only the CLI knows its command catalog, so the core link adds this to decoded tool activity
// and to transcript pages; provider adapters stay unaware of Lervo's commands.
import type { HostedDecodedContent, HostedToolDetail } from "@lervo/adapter-contract";

import { readKnowledgeQueryOutput } from "./knowledge-query-output.js";

type LervoCall = NonNullable<HostedToolDetail["lervo"]>;

interface Token {
  readonly text: string;
  readonly quoted: boolean;
}

interface Segment {
  /** The control operator before the segment; empty for the first. */
  readonly operator: string;
  readonly words: readonly Token[];
}

const WORD = /^[a-z][a-z0-9-]*$/u;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const MAX_COMMAND_WORDS = 6;
const MAX_SUBJECT_CHARACTERS = 512;
/** A search's hits a line carries: the first in rank order, within the detail's bound. */
const MAX_HITS = 10;
const MAX_HIT_TITLE_CHARACTERS = 120;
const MAX_HIT_PATH_CHARACTERS = 240;
/** Commands that only move into a directory before the call. */
const PRELUDE = new Set(["cd", "pushd"]);
/** Commands after the call that keep the line Lervo's: another call, or a plain message. */
const FOLLOWERS = new Set(["echo", "true", "printf"]);

/**
 * The words and control operators of a shell line, with quotes removed. A quoted part marks its
 * word as quoted. An unclosed quote runs to the end, as a shortened command's might.
 */
function segments(line: string): Segment[] {
  const result: Segment[] = [];
  let words: Token[] = [];
  let operator = "";
  let word = "";
  let quoted = false;
  let started = false;
  const endWord = () => {
    if (started) words.push({ text: word, quoted });
    word = "";
    quoted = false;
    started = false;
  };
  const endSegment = (next: string) => {
    endWord();
    result.push({ operator, words });
    words = [];
    operator = next;
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
      endSegment(";");
    } else if ((character === "&" || character === "|") && next === character) {
      endSegment(character + character);
      index += 1;
    } else if (character === "|") {
      endSegment("|");
    } else if (character === "&" && !started) {
      endSegment(";");
    } else if (character === " " || character === "\t") {
      endWord();
    } else {
      word += character;
      started = true;
    }
  }
  endSegment("");
  return result.filter((segment) => segment.words.length > 0);
}

function program(segment: Segment): Token[] {
  const words = [...segment.words];
  while (words.length > 0 && !words[0]!.quoted && ASSIGNMENT.test(words[0]!.text)) words.shift();
  return words;
}

const isLervo = (token: Token | undefined) =>
  token !== undefined && token.text.split("/").at(-1) === "lervo";

function shortened(text: string, characters = MAX_SUBJECT_CHARACTERS): string {
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
    ...(subject === undefined ? {} : { subject: shortened(subject.text) }),
  };
}

/**
 * The Lervo call a shell line makes, or undefined when the line's own work is something else. The
 * line may move into a directory first, pipe the call's output into a filter, and follow it with
 * another Lervo call or a message; a line that runs other commands stays a shell call.
 */
export function lervoInvocation(
  line: string,
  commands: ReadonlySet<string>,
): LervoCall | undefined {
  let found: LervoCall | undefined;
  for (const segment of segments(line)) {
    const words = program(segment);
    if (words.length === 0) continue;
    if (found === undefined) {
      if (PRELUDE.has(words[0]!.text) && !words[0]!.quoted) continue;
      if (!isLervo(words[0])) return undefined;
      found = call(words.slice(1), commands);
      continue;
    }
    if (segment.operator === "|" || isLervo(words[0]) || FOLLOWERS.has(words[0]!.text)) continue;
    return undefined;
  }
  return found;
}

/** `content` without the shell output its adapter passed to the core. */
export function withoutShellOutput(content: HostedDecodedContent): HostedDecodedContent {
  if (content.kind !== "tool_activity" || content.output === undefined) return content;
  const { output: _output, ...line } = content;
  return line;
}

/**
 * `content` with the Lervo call its shell command makes, when it makes one, and without its shell
 * output. A knowledge search adds how many documents it found and the first of them; its list
 * then stands in for the output's preview.
 */
export function withLervoCall(
  content: HostedDecodedContent,
  commands: ReadonlySet<string>,
): HostedDecodedContent {
  const line = withoutShellOutput(content);
  if (line.kind !== "tool_activity" || line.detail?.subject.kind !== "command") return line;
  const lervo = lervoInvocation(line.detail.subject.text, commands);
  if (lervo === undefined) return line;
  const output = content.kind === "tool_activity" ? content.output : undefined;
  const search =
    lervo.command === "knowledge query" && lervo.flag === undefined && output !== undefined
      ? readKnowledgeQueryOutput(output)
      : undefined;
  if (search === undefined) return { ...line, detail: { ...line.detail, lervo } };
  const hits = search.hits.slice(0, MAX_HITS).map((hit) => ({
    title: shortened(hit.title, MAX_HIT_TITLE_CHARACTERS),
    path: shortened(hit.path, MAX_HIT_PATH_CHARACTERS),
    freshness: hit.freshness,
  }));
  const { preview, ...detail } = line.detail;
  return {
    ...line,
    detail: {
      ...(hits.length > 0 || preview === undefined ? detail : { ...detail, preview }),
      lervo: { ...lervo, found: search.found, ...(hits.length > 0 ? { hits } : {}) },
    },
  };
}
