import { execFile } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { promisify } from "node:util";

import { loadDecisionTaxonomy, type RepositoryDocumentRole } from "@lervo/project";

import {
  declaredPackageManager,
  documentToolOwnership,
  packageManagerWritesLockfile,
  RELEASE_PLEASE_CONFIGURATION_PATH,
  RELEASE_PLEASE_MANIFEST_PATH,
  releasePleaseChangelogPaths,
  type DocumentToolOwnershipEvidence,
} from "./document-tool-ownership.js";

const execute = promisify(execFile);

/** The identity Lervo commits its own knowledge outputs with; its commits never prove ownership. */
export const LERVO_KNOWLEDGE_COMMIT_EMAIL = "knowledge@lervo.invalid";

const MAXIMUM_PATHS = 4096;
const PATHSPEC_CHUNK = 256;
const HISTORY_COMMITS = 512;
const LEADING_BYTES = 1024;
const CONFIGURATION_BYTES = 256 * 1024;

async function git(root: string, args: string[], input?: string): Promise<string | null> {
  try {
    const running = execute("git", ["-C", root, ...args], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    // Git may exit before reading its input, for example outside a repository; a broken pipe
    // then fails only this probe, through the rejected result below.
    running.child.stdin?.on("error", () => undefined);
    running.child.stdin?.end(input ?? "");
    return (await running).stdout;
  } catch {
    return null;
  }
}

async function json(root: string, path: string): Promise<unknown> {
  try {
    const bytes = await readFile(resolve(root, path));
    if (bytes.byteLength > CONFIGURATION_BYTES) return null;
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

async function leadingContent(root: string, path: string): Promise<string | null> {
  let handle;
  try {
    handle = await open(resolve(root, path), "r");
    const buffer = Buffer.alloc(LEADING_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, LEADING_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * ADR-0491: lockfiles among `paths` that the package manager declared by their own `package.json`,
 * or by the nearest ancestor `package.json` that declares one (a workspace root), writes.
 */
async function packageManagerOutputs(
  root: string,
  paths: readonly string[],
): Promise<Map<string, DocumentToolOwnershipEvidence>> {
  const outputs = new Map<string, DocumentToolOwnershipEvidence>();
  const manifests = new Map<string, unknown>();
  const manifest = async (directory: string) => {
    if (!manifests.has(directory))
      manifests.set(directory, await json(root, posix.join(directory, "package.json")));
    return manifests.get(directory);
  };
  for (const path of paths) {
    const directory = posix.dirname(path);
    if ((await manifest(directory)) === null) continue;
    for (let current = directory; ; current = posix.dirname(current)) {
      const manager = declaredPackageManager(await manifest(current));
      if (manager !== null) {
        if (packageManagerWritesLockfile(manager, posix.basename(path)))
          outputs.set(path, {
            kind: "generator_configuration",
            generator: "package_manager",
            packageManager: manager,
            configurationPath: posix.join(current, "package.json"),
          });
        break;
      }
      if (current === ".") break;
    }
  }
  return outputs;
}

async function generatorOutputs(
  root: string,
  paths: readonly string[],
): Promise<Map<string, DocumentToolOwnershipEvidence>> {
  const outputs = await packageManagerOutputs(root, paths);
  const configuration = await json(root, RELEASE_PLEASE_CONFIGURATION_PATH);
  if (configuration === null) return outputs;
  const manifest = await json(root, RELEASE_PLEASE_MANIFEST_PATH);
  for (const path of releasePleaseChangelogPaths({ configuration, manifest }))
    outputs.set(path, {
      kind: "generator_configuration",
      generator: "release_please",
      configurationPath: RELEASE_PLEASE_CONFIGURATION_PATH,
    });
  return outputs;
}

/** Paths whose `linguist-generated` attribute is set by the repository's `.gitattributes`. */
async function generatedAttributes(root: string, paths: readonly string[]): Promise<Set<string>> {
  const generated = new Set<string>();
  const output = await git(
    root,
    ["check-attr", "-z", "--stdin", "linguist-generated"],
    paths.map((path) => `${path}\0`).join(""),
  );
  if (output === null) return generated;
  const fields = output.split("\0");
  for (let index = 0; index + 2 < fields.length; index += 3)
    if (fields[index + 2] === "set" || fields[index + 2] === "true") generated.add(fields[index]!);
  return generated;
}

/** The authors of recent non-merge, non-Lervo commits that touched each path, newest first. */
async function authorHistory(
  root: string,
  paths: readonly string[],
): Promise<Map<string, { name: string; email: string }[]>> {
  const history = new Map<string, { name: string; email: string }[]>();
  for (let start = 0; start < paths.length; start += PATHSPEC_CHUNK) {
    const chunk = paths.slice(start, start + PATHSPEC_CHUNK);
    const output = await git(root, [
      "-c",
      "core.quotePath=false",
      "log",
      "--no-merges",
      `--max-count=${HISTORY_COMMITS}`,
      "--format=%x1e%an%x00%ae",
      "--name-only",
      "--",
      ...chunk.map((path) => `:(literal)${path}`),
    ]);
    if (output === null) continue;
    const wanted = new Set(chunk);
    for (const entry of output.split("\x1e")) {
      const [identity, ...files] = entry.split("\n");
      const [name, email] = (identity ?? "").split("\0");
      if (name === undefined || email === undefined || email === LERVO_KNOWLEDGE_COMMIT_EMAIL)
        continue;
      for (const file of files)
        if (wanted.has(file))
          history.set(file, [...(history.get(file) ?? []), { name: name.trim(), email }]);
    }
  }
  return history;
}

/**
 * ADR-0473: the paths among `paths` that a repository tool owns, each with the evidence that
 * proves it. Every probe is read-only and fails toward user ownership: an unreadable
 * configuration, a missing Git history, or an unreadable file contributes no evidence.
 */
export async function observeToolGeneratedDocuments(input: {
  repositoryRoot: string;
  paths: readonly string[];
  roles?: readonly RepositoryDocumentRole[];
}): Promise<Map<string, DocumentToolOwnershipEvidence[]>> {
  const root = resolve(input.repositoryRoot);
  const paths = [...new Set(input.paths)].sort().slice(0, MAXIMUM_PATHS);
  const owned = new Map<string, DocumentToolOwnershipEvidence[]>();
  if (paths.length === 0) return owned;
  const roles =
    input.roles ??
    (await loadDecisionTaxonomy(root).then(
      (taxonomy) => taxonomy.documentPolicy.roles,
      () => [] as RepositoryDocumentRole[],
    ));
  const [outputs, attributes, history] = await Promise.all([
    generatorOutputs(root, paths),
    generatedAttributes(root, paths),
    authorHistory(root, paths),
  ]);
  for (const path of paths) {
    const evidence = documentToolOwnership({
      path,
      roles,
      generatorOutputs: outputs,
      generatedAttribute: attributes.has(path),
      leadingContent: await leadingContent(root, path),
      history: history.get(path) ?? [],
    });
    if (evidence.length > 0) owned.set(path, evidence);
  }
  return owned;
}

/** The included Markdown sources of one scan that a repository tool owns. */
export async function toolGeneratedDocumentPaths(
  root: string,
  scan: { sources: readonly { path: string; status: string }[] },
  taxonomy: { documentPolicy: { roles: readonly RepositoryDocumentRole[] } },
): Promise<Set<string>> {
  const paths = scan.sources
    .filter((source) => source.status === "included" && /\.md$/iu.test(source.path))
    .map((source) => source.path);
  return new Set(
    (
      await observeToolGeneratedDocuments({
        repositoryRoot: root,
        paths,
        roles: taxonomy.documentPolicy.roles,
      })
    ).keys(),
  );
}
