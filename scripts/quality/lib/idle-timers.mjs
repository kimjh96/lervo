import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const excludedSegments = new Set(["node_modules", "dist", "test", "tests", "fixtures"]);
/** A named period: a poll or interval constant or option set to a number. */
const periodName =
  /(?:^|[^\w$])((?:[A-Za-z_$][\w$]*)?(?:POLL|Poll|poll|INTERVAL|Interval|interval)[\w$]*?(?:MS|Ms|MILLISECONDS|Milliseconds))\s*[:=]\s*[0-9]/gu;
const reservedNames = new Set(["if", "for", "while", "switch", "catch", "function", "return"]);

export const idleTimerKinds = ["interval", "rearm", "loop", "period"];

function isProductionSource(path) {
  if (path.split("/").some((segment) => excludedSegments.has(segment))) return false;
  if (/\.(?:test|spec)\.[^.]+$/u.test(path)) return false;
  return sourceExtensions.has(path.slice(path.lastIndexOf(".")));
}

async function collect(root, path, files) {
  const absolute = join(root, path);
  let stat;
  try {
    stat = await lstat(absolute);
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (isProductionSource(path)) files.push(path);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const child = relative(root, join(absolute, entry.name)).split(sep).join("/");
    if (entry.isDirectory()) await collect(root, child, files);
    else if (entry.isFile() && isProductionSource(child)) files.push(child);
  }
}

/** Strips comments and string bodies so prose that names a timer is not counted. */
export function codeOnly(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:\\])\/\/.*$/gmu, "$1")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/gu, '""');
}

function closingParenthesis(code, open) {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === "(") depth += 1;
    else if (code[index] === ")" && (depth -= 1) === 0) return index;
  }
  return code.length;
}

function enclosingNames(header) {
  const names = [];
  const declarations =
    /(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>|^\s*(?:(?:private|public|protected|static|async|override)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]*)?$)/gmu;
  for (const match of header.matchAll(declarations)) {
    const name = match[1] ?? match[2] ?? match[3];
    if (name !== undefined && !reservedNames.has(name)) names.push(name);
  }
  return names;
}

const escape = (name) => name.replaceAll("$", "\\$");

/** Timer and scheduling calls whose callback runs later; each can re-arm or loop. */
const deferredCalls = ["setTimeout", "setImmediate", "process.nextTick", "queueMicrotask"];

function blockHeader(code, index) {
  // The header runs from the previous brace, so `for (;;)` keeps its loop keyword.
  return code
    .slice(Math.max(0, index - 240), index)
    .split(/[{}]/u)
    .at(-1);
}

/** Every named function body in the module: declarations, arrow constants and methods. */
function functionBodies(code) {
  const bodies = new Map();
  const open = [];
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] === "{")
      open.push({ index, names: enclosingNames(blockHeader(code, index).split(";").at(-1)) });
    else if (code[index] === "}") {
      const block = open.pop();
      if (block === undefined) continue;
      for (const name of block.names)
        bodies.set(name, `${bodies.get(name) ?? ""}\n${code.slice(block.index + 1, index)}`);
    }
  }
  return bodies;
}

/** Each top-level function declaration, up to the next top-level statement. */
function declarationSpans(code) {
  const spans = new Map();
  const starts = [
    ...code.matchAll(/^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gmu),
  ];
  for (const match of starts) {
    const from = match.index + match[0].length;
    const next = /^(?:export|function|async|const|let|var|class|interface|type|import)\b/mu.exec(
      code.slice(from),
    );
    spans.set(match[1], code.slice(from, next === null ? code.length : from + next.index));
  }
  return spans;
}

function calls(text, name) {
  return new RegExp(
    `(?:^|[^\\w$.])(?:this\\.)?${escape(name)}\\s*\\(|(?:^|[,(\\s=:])(?:this\\.)?${escape(name)}\\s*[,);]`,
    "u",
  ).test(text);
}

/** The functions a callback can reach through calls within this module. */
function reachable(callback, bodies) {
  const seen = new Set();
  const pending = [callback];
  while (pending.length > 0) {
    const text = pending.pop();
    for (const [name, body] of bodies) {
      if (seen.has(name) || !calls(text, name)) continue;
      seen.add(name);
      pending.push(body);
    }
  }
  return seen;
}

/**
 * Finds idle-wakeup shapes in code with comments and strings removed:
 * - `interval`: a `setInterval` call;
 * - `rearm`: a `setTimeout`, `setImmediate`, `process.nextTick` or `queueMicrotask` whose
 *   callback reaches, through calls within the module, a function that encloses it;
 * - `loop`: such a call, an awaited `sleep` or `delay`, or an awaited call of a function in this
 *   module that arms one, inside a `while`, `for` or `do`;
 * - `period`: a poll or interval constant or option set to a number.
 */
export function findIdleTimers(code) {
  const found = { interval: 0, rearm: 0, loop: 0, period: [] };
  const bodies = functionBodies(code);
  const deferredPattern = new RegExp(
    `(?:^|[^\\w$.])(?:${[...deferredCalls, "setInterval"].map(escape).join("|")})\\s*\\(`,
    "u",
  );
  // Module functions that arm a timer themselves or through calls within the module. A
  // top-level declaration spans to the next top-level statement, which also covers a function
  // whose parameters hold an object type and so whose body brace has no name of its own.
  const spans = new Map(bodies);
  for (const [name, span] of declarationSpans(code))
    spans.set(name, `${spans.get(name) ?? ""}\n${span}`);
  const arming = new Set(
    [...spans]
      .filter(([, body]) =>
        [body, ...[...reachable(body, spans)].map((reached) => spans.get(reached) ?? "")].some(
          (text) => deferredPattern.test(text),
        ),
      )
      .map(([name]) => name),
  );
  const blocks = [];
  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];
    if (character === "{") {
      blocks.push(blockHeader(code, index));
      continue;
    }
    if (character === "}") {
      blocks.pop();
      continue;
    }
    if (/[\w$.]/u.test(code[index - 1] ?? " ")) continue;
    const inLoop = blocks.some(
      (header) => /\b(?:while|for)\s*\([^]*\)\s*$/u.test(header) || /\bdo\s*$/u.test(header),
    );
    if (code.startsWith("setInterval(", index)) {
      found.interval += 1;
      continue;
    }
    const deferred = deferredCalls.find((name) => code.startsWith(`${name}(`, index));
    if (deferred !== undefined) {
      const open = index + deferred.length;
      // The closing parenthesis stays, so a bare callback name still reads as a reference.
      const callback = code.slice(open + 1, closingParenthesis(code, open) + 1);
      const enclosing = new Set(
        blocks.flatMap((header) => enclosingNames(header.split(";").at(-1))),
      );
      const reached = reachable(callback, bodies);
      if ([...enclosing].some((name) => reached.has(name) || calls(callback, name)))
        found.rearm += 1;
      else if (inLoop) found.loop += 1;
      continue;
    }
    if (inLoop && /^await\s+(?:sleep|delay)\w*\s*\(/u.test(code.slice(index, index + 40))) {
      found.loop += 1;
      continue;
    }
    const awaited = inLoop ? /^await\s+([\w$]+)\s*\(/u.exec(code.slice(index, index + 80)) : null;
    if (awaited !== null && arming.has(awaited[1])) found.loop += 1;
  }
  for (const match of code.matchAll(periodName)) found.period.push(match[1]);
  return found;
}

/**
 * ADR-0602: resident and service code waits on change signals and deadlines. A `setInterval`, a
 * re-arming timer, a sleeping loop or a named poll period needs an allowlist entry with a reason,
 * and an entry that no longer matches the code fails as stale.
 */
export async function inspectIdleTimers({ repositoryRoot, allowlist }) {
  const issues = [];
  const files = [];
  for (const path of allowlist.scope) await collect(repositoryRoot, path, files);
  const allowed = new Map();
  for (const entry of allowlist.entries) {
    if (!idleTimerKinds.includes(entry.kind))
      issues.push(`${entry.path} lists an unknown idle-timer kind ${entry.kind}.`);
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 10)
      issues.push(`${entry.path} needs a reason in the idle-timer allowlist.`);
    const key =
      entry.kind === "period"
        ? `${entry.path}#period#${entry.name}`
        : `${entry.path}#${entry.kind}`;
    allowed.set(key, entry);
  }
  const seen = new Set();
  for (const path of files.sort()) {
    const found = findIdleTimers(codeOnly(await readFile(join(repositoryRoot, path), "utf8")));
    for (const kind of ["interval", "rearm", "loop"]) {
      const count = found[kind];
      if (count === 0) continue;
      const key = `${path}#${kind}`;
      seen.add(key);
      const entry = allowed.get(key);
      if (entry === undefined)
        issues.push(
          `${path} adds a ${kind} timer; wait on a change signal or one deadline, or list it with a reason.`,
        );
      else if (entry.count !== count)
        issues.push(`${path} has ${count} ${kind} timers; the allowlist expects ${entry.count}.`);
    }
    for (const name of new Set(found.period)) {
      const key = `${path}#period#${name}`;
      seen.add(key);
      if (!allowed.has(key))
        issues.push(
          `${path} sets the period ${name}; wait on a change signal or one deadline, or list it with a reason.`,
        );
    }
  }
  for (const [key, entry] of allowed)
    if (!seen.has(key))
      issues.push(
        `${entry.path} no longer has the ${entry.kind}${entry.name === undefined ? "" : ` ${entry.name}`} timer; remove its allowlist entry.`,
      );
  return { files, issues };
}
