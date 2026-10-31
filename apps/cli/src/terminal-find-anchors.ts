/**
 * ADR-0538: exact prompt anchors. A token selects context only when it identifies a target
 * exactly: a snapshot path written as a path, a file name that names one file, an explicit skill
 * invocation, or a decision number. Free words are ignored, never interpreted, so no keyword rule
 * decides meaning.
 */

const MAXIMUM_PATH_ANCHORS = 16;
const MAXIMUM_POINTERS = 3;
const MAXIMUM_PROMPT_CHARACTERS = 16_384;
const MAXIMUM_QUOTED_CHARACTERS = 512;

export interface TerminalFindPointer {
  kind: "skill" | "decision" | "instruction";
  name: string;
  path: string;
  contentHash: string;
}

export interface TerminalFindAnchors {
  /** Repository-relative files and directories named exactly by the prompt. */
  paths: string[];
  pointers: TerminalFindPointer[];
}

const SKILL_FILE = /^\.agents\/skills\/([^/]+)\/SKILL\.md$/u;
const DECISION_FILE = /^docs\/decisions\/(?:.+\/)?(\d{4})-[^/]+\.md$/u;
/** A file name, as opposed to a free word, carries an extension. */
const FILE_NAME = /^[^/]+\.[A-Za-z0-9]{1,16}$/u;
/** Korean particles are one to three syllables attached to the reference ("screen.tsx를"). */
const TRAILING_PARTICLE = /\p{Script=Hangul}{1,3}$/u;
const DUPLICATE = "";

/**
 * Whitespace and quoting separate tokens; brackets and parentheses do not, because they occur
 * inside real paths (`app/[lang]/page.tsx`, `app/(shop)/layout.tsx`). A backtick span is also kept
 * whole so a quoted path with spaces stays one token.
 */
function promptTokens(prompt: string): string[] {
  const bounded = prompt.slice(0, MAXIMUM_PROMPT_CHARACTERS);
  const quoted = [...bounded.matchAll(/`([^`\n]{1,512})`/gu)]
    .map((match) => match[1]!)
    .filter((span) => span.length <= MAXIMUM_QUOTED_CHARACTERS && /\s/u.test(span));
  return [...quoted, ...bounded.split(/[\s`'"<>{},;!?]+/u)].filter((token) => token.length > 0);
}

/**
 * Spellings of one token, most exact first. Only fixed character rules apply: a leading `./`,
 * enclosing brackets or punctuation, a `:line` suffix, and then an attached Korean particle.
 */
function tokenSpellings(token: string): string[] {
  const plain = token.replace(/^\.\//u, "");
  const trimmed = plain
    .replace(/^[([]+/u, "")
    .replace(/[)\].:]+$/u, "")
    .replace(/:\d+(?::\d+)?$/u, "");
  const particle = trimmed.replace(TRAILING_PARTICLE, "").replace(/[)\].:]+$/u, "");
  return [...new Set([plain, trimmed, particle])].filter((spelling) => spelling.length > 0);
}

/**
 * Pure: anchors from the prompt against the current snapshot file map (path to content hash).
 * The work is linear in the snapshot and the bounded prompt, and the result is deterministic.
 */
export function extractTerminalFindAnchors(
  prompt: string,
  files: Readonly<Record<string, string>>,
): TerminalFindAnchors {
  const tokens = promptTokens(prompt);
  if (tokens.length === 0) return { paths: [], pointers: [] };
  // Basename and decision indexes hold one path, or DUPLICATE when two files share the key.
  const byBasename = new Map<string, string>();
  const decisions = new Map<string, string>();
  const skills = new Map<string, string>();
  const directories = new Set<string>();
  for (const path of Object.keys(files)) {
    const basename = path.slice(path.lastIndexOf("/") + 1);
    byBasename.set(basename, byBasename.has(basename) ? DUPLICATE : path);
    const skill = SKILL_FILE.exec(path);
    if (skill !== null) skills.set(skill[1]!, path);
    const decision = DECISION_FILE.exec(path)?.[1];
    if (decision !== undefined) decisions.set(decision, decisions.has(decision) ? DUPLICATE : path);
    for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
      const directory = path.slice(0, index);
      if (directories.has(directory)) break;
      directories.add(directory);
    }
  }

  const anchoredPaths: string[] = [];
  const pointers: TerminalFindPointer[] = [];
  const addPointer = (pointer: TerminalFindPointer) => {
    if (pointers.length < MAXIMUM_POINTERS && !pointers.some((item) => item.path === pointer.path))
      pointers.push(pointer);
  };
  // A path is written as a path: it contains a slash, or it is a file name with an extension.
  // A bare word such as `docs` or `src` names nothing even when a directory has that name.
  const pathFor = (spelling: string): string | undefined => {
    if (spelling.includes("/")) {
      const path = spelling.replace(/\/+$/u, "");
      return Object.hasOwn(files, path) || directories.has(path) ? path : undefined;
    }
    if (!FILE_NAME.test(spelling)) return undefined;
    if (Object.hasOwn(files, spelling)) return spelling;
    const match = byBasename.get(spelling);
    return match === undefined || match === DUPLICATE ? undefined : match;
  };
  const decisionFor = (spelling: string, next: string | undefined) => {
    const number =
      /^ADR-?(\d{4})$/iu.exec(spelling)?.[1] ??
      (/^ADR$/iu.test(spelling) && next !== undefined && /^\d{4}$/u.test(next) ? next : undefined);
    const path = number === undefined ? undefined : decisions.get(number);
    // A number shared by two files is ambiguous and names nothing.
    return path === undefined || path === DUPLICATE ? undefined : { number: number!, path };
  };

  for (const [index, token] of tokens.entries()) {
    // Only an exact invocation names a skill: `/name` (Claude) or `$name` (Codex). A bare word
    // that equals a skill identifier, such as a repository name, names nothing.
    const skillPath = /^[/$][^/]+$/u.test(token) ? skills.get(token.slice(1)) : undefined;
    if (skillPath !== undefined) {
      addPointer({
        kind: "skill",
        name: token.slice(1),
        path: skillPath,
        contentHash: files[skillPath]!,
      });
      continue;
    }
    const nextSpelling =
      tokens[index + 1] === undefined ? undefined : tokenSpellings(tokens[index + 1]!).at(-1);
    // The most exact spelling that names something wins; a looser spelling is never added too.
    for (const spelling of tokenSpellings(token)) {
      const decision = decisionFor(spelling, nextSpelling);
      if (decision !== undefined) {
        addPointer({
          kind: "decision",
          name: `ADR-${decision.number}`,
          path: decision.path,
          contentHash: files[decision.path]!,
        });
        break;
      }
      const path = pathFor(spelling);
      if (path !== undefined) {
        if (!anchoredPaths.includes(path) && anchoredPaths.length < MAXIMUM_PATH_ANCHORS)
          anchoredPaths.push(path);
        break;
      }
    }
  }
  // A named path is governed by the nearest nested AGENTS.md above it. Providers do not all read
  // nested instruction files on their own, so the hook points at it; the root file is always read.
  for (const path of anchoredPaths) {
    const segments = path.split("/");
    for (let length = segments.length; length >= 1; length -= 1) {
      const candidate = `${segments.slice(0, length).join("/")}/AGENTS.md`;
      if (Object.hasOwn(files, candidate)) {
        addPointer({
          kind: "instruction",
          name: candidate,
          path: candidate,
          contentHash: files[candidate]!,
        });
        break;
      }
    }
  }
  return { paths: anchoredPaths, pointers };
}

/** One short line per pointer; the hook delivers pointers, never bodies. */
export function formatTerminalFindPointer(pointer: TerminalFindPointer): string {
  return pointer.kind === "instruction"
    ? `Lervo find: ${pointer.path} (${pointer.contentHash}) governs a path named in the prompt; read it before changing that path.`
    : `Lervo find: ${pointer.kind} ${pointer.name} (${pointer.path}, ${pointer.contentHash}), named in the prompt.`;
}
