import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { delegatedRetrievalDigest } from "./delegated-retrieval-contract.mjs";

const excludedWorkspaceRoots = [
  ".git",
  ".lervo/state",
  "benchmarks",
  "node_modules",
  "docs/evidence/search",
  "docs/knowledge",
];

export function isWithinPath(path, root) {
  return path === root || path.startsWith(`${root}${sep}`);
}

export async function copySanitizedEvaluationWorkspace(sourceRoot, targetRoot, suite) {
  const excluded = [...excludedWorkspaceRoots, ...(suite?.corpusExclusions ?? [])];
  await cp(sourceRoot, targetRoot, {
    recursive: true,
    filter: (source) => {
      const path = relative(sourceRoot, source);
      return !excluded.some((root) => isWithinPath(path, root));
    },
  });
}

export function observeRepositorySnapshot(repositoryRoot) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return { head, workingTreeStatusDigest: delegatedRetrievalDigest(status) };
}

function contentHash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sourceId(path) {
  return `doc_${createHash("sha256").update(path).digest("hex").slice(0, 24)}`;
}

async function markdownFiles(path) {
  const metadata = await stat(path);
  if (metadata.isFile()) return path.endsWith(".md") ? [path] : [];
  if (!metadata.isDirectory()) return [];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => markdownFiles(resolve(path, entry.name))),
  );
  return nested.flat();
}

export async function loadDelegatedRetrievalCorpus(repositoryRoot, suite) {
  const excluded = suite.corpusExclusions.map((path) => resolve(repositoryRoot, path));
  const nested = await Promise.all(
    suite.corpusRoots.map((path) => markdownFiles(resolve(repositoryRoot, path))),
  );
  const paths = [...new Set(nested.flat())]
    .filter((path) => !excluded.some((root) => isWithinPath(path, root)))
    .sort();
  return Promise.all(
    paths.map(async (path) => {
      const bytes = await readFile(path);
      const repositoryPath = relative(repositoryRoot, path).split(sep).join("/");
      const text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
      const heading = /^#{1,6}\s+(.+)$/mu.exec(text)?.[1]?.trim();
      return {
        kind: "document",
        sourceId: sourceId(repositoryPath),
        path: repositoryPath,
        contentHash: contentHash(bytes),
        ...(heading === undefined ? {} : { title: heading }),
        labels: repositoryPath.split("/"),
        text,
      };
    }),
  );
}
