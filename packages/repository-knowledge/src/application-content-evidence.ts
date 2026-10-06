import { basename, extname, posix } from "node:path";

import type { RepositorySourceKind } from "./types.js";

/**
 * ADR-0476 evidence that Markdown is application content: bytes the repository's own code or
 * build consumes, so they are not repository documentation and never a layout migration
 * candidate. Every kind is an observed fact about the repository, never a word in a title.
 */
export type ApplicationContentEvidence =
  | {
      kind: "source_reference";
      /** The workspace package that owns both files; `.` is a root manifest. */
      packageRoot: string;
      sourcePath: string;
      /** The referenced document, directory, or static glob prefix the reference resolves to. */
      target: string;
      targetKind: "document" | "directory" | "glob";
    }
  | {
      kind: "source_tree_member";
      packageRoot: string;
      /** The closest directory above the document that holds the package's own source modules. */
      sourceTree: string;
      sourcePath: string;
    };

export interface ApplicationContentSource {
  path: string;
  kind: RepositorySourceKind;
  status: string;
  content?: string;
}

/** Files whose presence declares a workspace package boundary. */
const PACKAGE_MANIFESTS = new Set([
  "package.json",
  "deno.json",
  "deno.jsonc",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "composer.json",
  "pubspec.yaml",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
  "mix.exs",
  "Package.swift",
]);
const REFERENCING_KINDS = new Set<RepositorySourceKind>([
  "code",
  "configuration",
  "build_definition",
  "schema",
  "other",
]);
const MAXIMUM_SCANNED_SOURCE_BYTES = 512 * 1024;
const MAXIMUM_LITERAL_LENGTH = 300;
const MAXIMUM_EVIDENCE_PER_DOCUMENT = 4;
const ADJACENT_LITERAL_SEPARATOR = /^\s*,\s*$/u;

function moduleSource(path: string, kind: RepositorySourceKind): boolean {
  return kind === "code" || /\.(?:[cm][jt]s|svelte|astro)$/iu.test(path);
}

/** Directories a package manifest declares, deepest first so the closest owner wins. */
export function workspacePackageRoots(sources: readonly { path: string }[]): string[] {
  return [
    ...new Set(
      sources
        .filter((source) => PACKAGE_MANIFESTS.has(basename(source.path)))
        .map((source) => posix.dirname(source.path)),
    ),
  ].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function within(path: string, directory: string): boolean {
  return directory === "." ? !path.startsWith("../") : path.startsWith(`${directory}/`);
}

export function owningWorkspacePackage(path: string, roots: readonly string[]): string | null {
  return roots.find((root) => within(path, root)) ?? null;
}

interface StringLiteral {
  start: number;
  end: number;
  /** The literal text, or a template literal's static prefix before its first substitution. */
  value: string;
}

/** Quoted literals of any C-like or scripting syntax; an unterminated quote yields nothing. */
function stringLiterals(content: string): StringLiteral[] {
  const literals: StringLiteral[] = [];
  let index = 0;
  while (index < content.length) {
    const quote = content[index]!;
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    let value = "";
    let substituted = false;
    let closed = false;
    while (cursor < content.length) {
      const character = content[cursor]!;
      if (character === "\\") {
        if (!substituted) value += content.slice(cursor, cursor + 2);
        cursor += 2;
        continue;
      }
      if (character === quote) {
        closed = true;
        break;
      }
      if (character === "\n" && quote !== "`") break;
      if (quote === "`" && character === "$" && content[cursor + 1] === "{") substituted = true;
      if (!substituted) value += character;
      cursor += 1;
    }
    if (closed) literals.push({ start: index, end: cursor + 1, value });
    index = closed ? cursor + 1 : index + 1;
  }
  return literals;
}

/**
 * Path-like literals in one source, plus each run of adjacent literal arguments joined by `/`,
 * so `join(root, "app", "[lang]", "_data")` yields `app/[lang]/_data`.
 */
function pathLiterals(content: string): string[] {
  const literals: string[] = [];
  let run: string[] = [];
  let previousEnd = -1;
  for (const literal of stringLiterals(content)) {
    if (
      previousEnd >= 0 &&
      ADJACENT_LITERAL_SEPARATOR.test(content.slice(previousEnd, literal.start))
    )
      run.push(literal.value);
    else {
      if (run.length > 1) literals.push(run.join("/"));
      run = [literal.value];
    }
    previousEnd = literal.end;
    literals.push(literal.value);
  }
  if (run.length > 1) literals.push(run.join("/"));
  return literals.filter(
    (literal) =>
      literal.length >= 2 &&
      literal.length <= MAXIMUM_LITERAL_LENGTH &&
      !/\s/u.test(literal) &&
      !/^[a-z][a-z0-9+.-]*:/iu.test(literal) &&
      !/^[@~#]/u.test(literal),
  );
}

interface ResolvedReference {
  target: string;
  targetKind: "document" | "directory" | "glob";
  /** For a glob, the pattern after the static prefix; it must admit the document's extension. */
  pattern?: string;
}

function resolveReference(
  literal: string,
  sourcePath: string,
  packageRoot: string,
): ResolvedReference[] {
  const globStart = literal.search(/[*?{]/u);
  const glob = globStart >= 0;
  const staticPart = glob ? literal.slice(0, literal.lastIndexOf("/", globStart) + 1) : literal;
  const relative = staticPart.replace(/\/+$/u, "");
  const sourceDirectory = posix.dirname(sourcePath);
  const bases = /^\.\.?\//u.test(literal)
    ? [sourceDirectory]
    : literal.startsWith("/")
      ? [packageRoot]
      : literal.includes("/") || glob
        ? [sourceDirectory, packageRoot]
        : [sourceDirectory];
  const resolved: ResolvedReference[] = [];
  for (const base of new Set(bases)) {
    const target = posix.normalize(posix.join(base, relative.replace(/^\/+/u, "")));
    if (target.startsWith("../") || target === "..") continue;
    if (target !== packageRoot && !within(target, packageRoot)) continue;
    resolved.push(
      glob
        ? { target, targetKind: "glob", pattern: literal.slice(staticPart.length) }
        : { target, targetKind: /\.mdx?$/iu.test(target) ? "document" : "directory" },
    );
  }
  return resolved;
}

function globAdmits(pattern: string, documentPath: string): boolean {
  const extension = extname(documentPath).slice(1).toLowerCase();
  return new RegExp(`(?:^|[^a-z0-9])${extension}(?:[^a-z0-9]|$)`, "u").test(pattern.toLowerCase());
}

function referenceEvidence(
  documentPath: string,
  packageRoot: string,
  reference: ResolvedReference,
  sourcePath: string,
): ApplicationContentEvidence | null {
  const matches =
    reference.targetKind === "document"
      ? reference.target === documentPath
      : reference.targetKind === "directory"
        ? reference.target !== packageRoot && within(documentPath, reference.target)
        : reference.target !== packageRoot &&
          within(documentPath, reference.target) &&
          globAdmits(reference.pattern ?? "", documentPath);
  return matches
    ? {
        kind: "source_reference",
        packageRoot,
        sourcePath,
        target: reference.target,
        targetKind: reference.targetKind,
      }
    : null;
}

function sourceTreeEvidence(
  documentPath: string,
  packageRoot: string,
  moduleDirectories: ReadonlyMap<string, string>,
): ApplicationContentEvidence | null {
  for (
    let directory = posix.dirname(documentPath);
    directory !== packageRoot && directory !== ".";
    directory = posix.dirname(directory)
  ) {
    const sourcePath = moduleDirectories.get(directory);
    if (sourcePath !== undefined)
      return { kind: "source_tree_member", packageRoot, sourceTree: directory, sourcePath };
  }
  return null;
}

/**
 * Observes which Markdown documents their own workspace package consumes. Documents under the
 * repository documentation root are repository documentation by the reviewed layout and never
 * receive evidence; neither does Markdown outside any declared workspace package.
 */
export function observeApplicationContent(input: {
  sources: readonly ApplicationContentSource[];
  documentPaths: readonly string[];
  documentationRoot: string;
}): Map<string, ApplicationContentEvidence[]> {
  const roots = workspacePackageRoots(input.sources);
  const documents = input.documentPaths.filter(
    (path) =>
      !within(path, input.documentationRoot) &&
      path !== input.documentationRoot &&
      owningWorkspacePackage(path, roots) !== null,
  );
  const evidence = new Map<string, ApplicationContentEvidence[]>();
  if (documents.length === 0) return evidence;
  const packagesWithDocuments = new Set(
    documents.map((path) => owningWorkspacePackage(path, roots)!),
  );
  // Keyed by package root, then by resolved target, so each document only visits its ancestors.
  const references = new Map<
    string,
    Map<string, Array<{ reference: ResolvedReference; sourcePath: string }>>
  >();
  const moduleDirectories = new Map<string, string>();
  for (const source of [...input.sources].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    if (source.status !== "included" || source.content === undefined) continue;
    if (!REFERENCING_KINDS.has(source.kind) || source.path.startsWith(".lervo/")) continue;
    const packageRoot = owningWorkspacePackage(source.path, roots);
    if (packageRoot === null || !packagesWithDocuments.has(packageRoot)) continue;
    if (
      moduleSource(source.path, source.kind) &&
      !moduleDirectories.has(posix.dirname(source.path))
    )
      moduleDirectories.set(posix.dirname(source.path), source.path);
    if (source.content.length > MAXIMUM_SCANNED_SOURCE_BYTES) continue;
    const byTarget = references.get(packageRoot) ?? new Map();
    references.set(packageRoot, byTarget);
    for (const literal of new Set(pathLiterals(source.content)))
      for (const reference of resolveReference(literal, source.path, packageRoot)) {
        const entries = byTarget.get(reference.target) ?? [];
        entries.push({ reference, sourcePath: source.path });
        byTarget.set(reference.target, entries);
      }
  }
  for (const documentPath of documents) {
    const packageRoot = owningWorkspacePackage(documentPath, roots)!;
    const byTarget = references.get(packageRoot);
    const found: ApplicationContentEvidence[] = [];
    for (
      let target = documentPath;
      byTarget !== undefined && target !== packageRoot && target !== ".";
      target = posix.dirname(target)
    ) {
      for (const { reference, sourcePath } of byTarget.get(target) ?? []) {
        const item = referenceEvidence(documentPath, packageRoot, reference, sourcePath);
        if (
          item !== null &&
          found.length < MAXIMUM_EVIDENCE_PER_DOCUMENT &&
          !found.some((existing) => JSON.stringify(existing) === JSON.stringify(item))
        )
          found.push(item);
      }
    }
    if (found.length === 0) {
      const member = sourceTreeEvidence(documentPath, packageRoot, moduleDirectories);
      if (member !== null) found.push(member);
    }
    if (found.length > 0) evidence.set(documentPath, found);
  }
  return evidence;
}
