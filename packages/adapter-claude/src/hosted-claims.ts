// Claims at first write for Claude Code (Lervo ADE coordination): the paths a tool call is about
// to write, and the pre-tool hook's answer. File tools name their path; a shell command is read
// for the few forms that plainly write, and anything it cannot resolve is left to the turn's end.
// The package exports this module alone as `./claims`, so the terminal hook runtime reads claims
// without loading the adapter.
import { dirname, isAbsolute, resolve } from "node:path";

import {
  type HostedClaimAnswering,
  type HostedClaimDecision,
  type HostedWriteIntent,
  type HostedWriteTarget,
  MAX_CLAIM_REASON_CHARACTERS,
} from "@lervo/adapter-contract";

const FILE_TOOLS: Readonly<Record<string, "file_path" | "notebook_path">> = {
  Edit: "file_path",
  Write: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};
/** The tools Claude Code's pre-tool hook sends for claims: the file tools, and the shell. */
export const CLAUDE_CLAIM_TOOLS = [...Object.keys(FILE_TOOLS), "Bash"].join("|");
/**
 * An output redirection: an optional descriptor such as `2` or `1`, its operator, and the operand
 * when it is attached, as in `2>err.log` or `>|out.txt`.
 */
const REDIRECTION = /^\d*(&>>|&>|>>|>\||>&|>)(.*)$/u;

/**
 * Whether a redirection's operand names a descriptor rather than a file. `2>&1` and `>&2`
 * duplicate one and `>&-` closes one, so they write no file; `>&out.txt` writes the file.
 */
function namesDescriptor(operator: string, operand: string): boolean {
  return (
    operand.startsWith("&") ||
    operand.startsWith("-") ||
    (operator === ">&" && /^\d+$/u.test(operand))
  );
}
const WILDCARD = /[*?[]/u;

/** The words of one shell statement, with quotes removed. */
type Words = { readonly words: readonly string[] };

/**
 * Splits a command into statements at `;`, `&&`, `||`, `|`, and line ends, outside quotes. The
 * `|` of `>|`, which writes over a file the shell would protect, stays in its word.
 */
function statements(command: string): Words[] {
  const all: Words[] = [];
  let words: string[] = [];
  let word = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  const endWord = () => {
    if (started) words.push(word);
    word = "";
    started = false;
  };
  const endStatement = () => {
    endWord();
    if (words.length > 0) all.push({ words });
    words = [];
  };
  for (let at = 0; at < command.length; at += 1) {
    const char = command[at]!;
    if (quote !== null) {
      if (char === quote) quote = null;
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === "\\" && at + 1 < command.length) {
      word += command[(at += 1)]!;
      started = true;
    } else if (char === " " || char === "\t") endWord();
    else if (char === "\n" || char === ";") endStatement();
    else if (char === "&" && command[at + 1] === "&") {
      endStatement();
      at += 1;
    } else if (char === "|" && !word.endsWith(">")) {
      endStatement();
      if (command[at + 1] === "|") at += 1;
    } else {
      word += char;
      started = true;
    }
  }
  endStatement();
  return all;
}

/** A target for an operand, or null when it cannot be resolved to a path. */
function target(operand: string, directory: string, kind: "file" | "directory") {
  if (operand.includes("$") || operand.includes("`") || operand.startsWith("~")) return null;
  const wildcard = operand.search(WILDCARD);
  if (wildcard >= 0) {
    // A glob claims the deepest directory before its first wildcard.
    const before = operand.slice(0, wildcard);
    const base = before.endsWith("/") ? before.slice(0, -1) : dirname(before);
    return { path: resolve(directory, base === "" ? "." : base), kind: "directory" as const };
  }
  return { path: isAbsolute(operand) ? resolve(operand) : resolve(directory, operand), kind };
}

const operandsOf = (words: readonly string[]) => words.filter((word) => !word.startsWith("-"));

/** The operands of a statement's command that it writes, with their kind. */
function written(words: readonly string[]): { operand: string; kind: "file" | "directory" }[] {
  const [command, ...rest] = words;
  const operands = operandsOf(rest);
  const recursive = rest.some((word) => /^-[a-zA-Z]*[rR]/u.test(word));
  switch (command) {
    case "tee":
    case "touch":
      return operands.map((operand) => ({ operand, kind: "file" }));
    case "mkdir":
    case "rmdir":
      return operands.map((operand) => ({ operand, kind: "directory" }));
    case "rm":
      return operands.map((operand) => ({ operand, kind: recursive ? "directory" : "file" }));
    case "mv":
      return operands.map((operand) => ({ operand, kind: "file" }));
    case "cp": {
      const last = operands.at(-1);
      return last === undefined ? [] : [{ operand: last, kind: recursive ? "directory" : "file" }];
    }
    case "sed":
    case "perl": {
      if (!rest.some((word) => /^-[a-zA-Z]*i/u.test(word))) return [];
      // The first operand is the script, after -e or alone; the rest are files.
      return operands.slice(1).map((operand) => ({ operand, kind: "file" }));
    }
    case "git": {
      const [subcommand, ...paths] = operands;
      return subcommand === "mv" || subcommand === "rm"
        ? paths.map((operand) => ({ operand, kind: "file" }))
        : [];
    }
    default:
      return [];
  }
}

/** The targets a shell command writes, following a leading `cd` and reading its redirections. */
function shellIntent(command: string, workingDirectory: string): HostedWriteIntent {
  const targets: HostedWriteTarget[] = [];
  let directory = workingDirectory;
  let undetected = false;
  const add = (operand: string, kind: "file" | "directory") => {
    const found = target(operand, directory, kind);
    if (found === null) undetected = true;
    else if (!found.path.startsWith("/dev/")) targets.push(found);
  };
  for (const statement of statements(command)) {
    const words: string[] = [];
    for (let at = 0; at < statement.words.length; at += 1) {
      const word = statement.words[at]!;
      // Input redirection reads; its file is not an operand.
      if (word.startsWith("<")) {
        if (word === "<" || word === "<<" || word === "<<<") at += 1;
        continue;
      }
      const redirect = REDIRECTION.exec(word);
      if (redirect === null) {
        words.push(word);
        continue;
      }
      const operator = redirect[1]!;
      const operand = redirect[2] !== "" ? redirect[2] : statement.words[(at += 1)];
      if (operand !== undefined && !namesDescriptor(operator, operand)) add(operand, "file");
    }
    if (words[0] === "cd" && words[1] !== undefined) {
      const moved = target(words[1], directory, "directory");
      if (moved === null) undetected = true;
      else directory = moved.path;
      continue;
    }
    for (const { operand, kind } of written(words)) add(operand, kind);
  }
  return { toolClass: "shell", targets, detection: undetected ? "undetected" : "parsed" };
}

/**
 * The write intent of a Claude Code tool call: a file tool's own path, or the targets a `Bash`
 * command plainly writes. It reads only the path fields and the command, never the content.
 */
export function claudeWriteIntent(
  toolName: string,
  input: unknown,
  workingDirectory: string,
): HostedWriteIntent | null {
  const fields = (input ?? {}) as Record<string, unknown>;
  const field = FILE_TOOLS[toolName];
  if (field !== undefined) {
    const path = fields[field];
    if (typeof path !== "string" || path.length === 0)
      return { toolClass: "file", targets: [], detection: "undetected" };
    return {
      toolClass: toolName === "NotebookEdit" ? "notebook" : "file",
      targets: [{ path: resolve(workingDirectory, path), kind: "file" }],
      detection: "exact",
    };
  }
  if (toolName !== "Bash") return null;
  const command = fields.command;
  return typeof command === "string"
    ? shellIntent(command, workingDirectory)
    : { toolClass: "shell", targets: [], detection: "undetected" };
}

/**
 * What Claude Code's `PreToolUse` hook prints. A refusal denies the call with its reason, which
 * Claude Code gives the model; anything else prints no decision, never `allow`, which would skip
 * the owner's own permission settings.
 */
export function claudeClaimAnswer(decision: HostedClaimDecision): string {
  if (decision.decision !== "deny") return "{}\n";
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: decision.reason.slice(0, MAX_CLAIM_REASON_CHARACTERS),
    },
  })}\n`;
}

/** Claude Code's claim reading, for the terminal hook runtime. */
export const claudeClaims: HostedClaimAnswering = {
  claimTools: CLAUDE_CLAIM_TOOLS,
  writeIntent: claudeWriteIntent,
  claimAnswer: claudeClaimAnswer,
};
