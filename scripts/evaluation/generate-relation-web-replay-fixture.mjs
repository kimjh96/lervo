// Generates the ADR-0562 acceptance replay fixture: the documents on origin/main before the
// ADR-0560 removal that still describe a removed part, found by an oracle that is independent of
// the relation web, plus the CLI command catalogs on both sides of the removal.
//
// Usage: node scripts/evaluation/generate-relation-web-replay-fixture.mjs [--write]
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const fixturePath = resolve(
  repositoryRoot,
  "packages/repository-knowledge/test/fixtures/relation-web-adr-0560-replay.json",
);
// Both sides of the ADR-0560 merge on main (pull request 286).
const before = "124ad123";
const after = "a9c25602";
const supersedingDocument =
  "docs/decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md";

function git(...args) {
  return execFileSync("git", ["-C", repositoryRoot, "-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

function revision(name) {
  return git("rev-parse", "--verify", `${name}^{commit}`).trim();
}

function list(output) {
  return output.split("\0").filter((item) => item !== "");
}

function show(rev, path) {
  return git("show", `${rev}:${path}`);
}

function withDirectories(files) {
  const paths = new Set();
  for (const file of files) {
    paths.add(file);
    const segments = file.split("/");
    for (let index = 1; index < segments.length; index++)
      paths.add(segments.slice(0, index).join("/"));
  }
  return paths;
}

/** Commands in usage text, where usage lines start a string or follow an escaped newline. */
function commandCatalog(rev) {
  const files = list(git("ls-tree", "-r", "-z", "--name-only", rev, "apps/cli/src")).filter(
    (path) => path.endsWith(".ts") && !path.endsWith(".test.ts"),
  );
  const commands = new Set();
  for (const path of files) {
    const source = show(rev, path);
    if (!/[A-Za-z]Usage\s*=/u.test(source)) continue;
    for (const match of source.matchAll(/(?:^|\\n|["'`])[ \t]*lervo((?: [a-z][a-z0-9-]*)+)/gmu))
      commands.add(`lervo${match[1]}`);
  }
  return [...commands].sort();
}

const historicalStatus = /^(?:superseded|historical|archived)(?![a-z])/u;

function historical(path, content) {
  if (path.startsWith("docs/archive/")) return true;
  const lines = content.split(/\r?\n/u);
  let index = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex(
      (line, position) => position > 0 && /^(?:---|\.\.\.)\s*$/u.test(line),
    );
    for (const line of lines.slice(1, end))
      if (/^(?:status|lifecycle)\s*:\s*["']?(?:historical|archived|superseded)/iu.test(line.trim()))
        return true;
    index = end + 1;
  }
  for (; index < lines.length && !/^\s{0,3}#{2,6}\s/u.test(lines[index]); index++) {
    const status = /^\s*(?:[-*]\s+)?Status\s*:\s*[`"'*_\s]*([a-z_]+)/u.exec(lines[index])?.[1];
    if (status !== undefined) return historicalStatus.test(status);
  }
  return false;
}

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function firstLine(content, pattern) {
  const index = content.search(pattern);
  return index < 0 ? null : content.slice(0, index).split("\n").length;
}

/** Paths a document names: link targets resolved from its directory, and inline code paths. */
function namedPaths(path, content) {
  const found = new Map();
  const lines = content.split(/\r?\n/u);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\]\(\s*<?([^)\s>]+)>?/gu)) {
      const target = match[1].replace(/[?#].*$/u, "");
      if (target === "" || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue;
      let decoded;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        continue;
      }
      const joined = decoded.startsWith("/")
        ? decoded.slice(1)
        : posix.join(posix.dirname(path), decoded);
      const normalized = posix.normalize(joined).replace(/\/$/u, "");
      if (!normalized.startsWith("..") && !found.has(normalized)) found.set(normalized, index + 1);
    }
    for (const match of line.matchAll(
      /`([A-Za-z0-9_.][A-Za-z0-9_./+@-]*\/[A-Za-z0-9_./+@-]*)`/gu,
    )) {
      const normalized = posix
        .normalize(match[1].replace(/:\d+(?::\d+)?$/u, ""))
        .replace(/\/$/u, "");
      if (!normalized.startsWith("..") && !found.has(normalized)) found.set(normalized, index + 1);
    }
  });
  return found;
}

const beforeRevision = revision(before);
const afterRevision = revision(after);
const beforeFiles = list(git("ls-tree", "-r", "-z", "--name-only", beforeRevision));
const afterFiles = list(git("ls-tree", "-r", "-z", "--name-only", afterRevision));
const deleted = new Set(
  list(
    git(
      "diff",
      "-z",
      "--no-renames",
      "--name-only",
      "--diff-filter=D",
      beforeRevision,
      afterRevision,
    ),
  ),
);
const afterPaths = withDirectories(afterFiles);
const removedPaths = new Set(
  [...withDirectories(beforeFiles)].filter((path) => !afterPaths.has(path)),
);
const removedPackages = beforeFiles
  .filter((path) => /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(path))
  .map((path) => ({
    directory: posix.dirname(path),
    name: JSON.parse(show(beforeRevision, path)).name,
  }))
  .filter((item) => removedPaths.has(item.directory));
const commandsBefore = commandCatalog(beforeRevision);
const commandsAfter = commandCatalog(afterRevision);
const afterCommandSet = new Set(commandsAfter);
const removedCommands = commandsBefore.filter((command) => !afterCommandSet.has(command));
const removedCommandSet = new Set(removedCommands);
const removedGroups = new Set();
for (const command of removedCommands) {
  const words = command.split(" ");
  for (let length = 2; length < words.length; length++) {
    const group = words.slice(0, length).join(" ");
    const members = commandsBefore.filter((item) => item === group || item.startsWith(`${group} `));
    if (members.every((member) => removedCommandSet.has(member))) removedGroups.add(group);
  }
}
const commandNames = [...removedCommands, ...removedGroups].sort();
const edited = new Set(
  list(
    git(
      "diff",
      "-z",
      "--no-renames",
      "--name-only",
      "--diff-filter=M",
      beforeRevision,
      afterRevision,
    ),
  ).filter((path) => /\.mdx?$/iu.test(path) && !path.startsWith(".lervo/")),
);

const expected = [];
for (const path of beforeFiles) {
  if (!/\.mdx?$/iu.test(path) || path.startsWith(".lervo/") || deleted.has(path)) continue;
  const content = show(beforeRevision, path);
  if (historical(path, content)) continue;
  const reasons = [];
  for (const item of removedPackages) {
    const name = `(?:${escape(item.name)}|${escape(item.directory)})(?![a-z0-9-])`;
    const line = firstLine(content, new RegExp(name, "u"));
    if (line !== null) reasons.push(`package ${item.name} (line ${line})`);
  }
  for (const command of commandNames) {
    const pattern = new RegExp(
      `(?<![A-Za-z0-9_./@-])${command.split(" ").map(escape).join(" ")}(?![a-z0-9-])`,
      "u",
    );
    const line = firstLine(content, pattern);
    if (line !== null) reasons.push(`command ${command} (line ${line})`);
  }
  for (const [target, line] of namedPaths(path, content))
    if (removedPaths.has(target)) reasons.push(`path ${target} (line ${line})`);
  if (reasons.length > 0) expected.push({ document: path, edited: edited.has(path), reasons });
}

const fixture = {
  schemaVersion: 1,
  description:
    "ADR-0562 acceptance replay: documents on origin/main before the ADR-0560 removal that still name a removed package, command, or path, by an oracle independent of the relation web. Generated by scripts/evaluation/generate-relation-web-replay-fixture.mjs; every entry was reviewed by reading the named line.",
  revisions: { before: beforeRevision, after: afterRevision },
  supersedingDocument,
  commands: { before: commandsBefore, after: commandsAfter },
  removedPackages: removedPackages.map((item) => item.name).sort(),
  expected,
  removalEdited: [...edited].sort(),
};
const text = `${JSON.stringify(fixture, null, 2)}\n`;
if (process.argv.includes("--write")) writeFileSync(fixturePath, text);
process.stdout.write(
  `before ${beforeRevision.slice(0, 12)} after ${afterRevision.slice(0, 12)}: ${expected.length} expected documents, ${removedCommands.length} removed commands, ${removedPackages.length} removed packages, ${edited.size} documents edited by the removal\n`,
);
