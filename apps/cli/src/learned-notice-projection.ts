import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { promisify } from "node:util";

import { LERVO_KNOWLEDGE_COMMIT_EMAIL } from "@lervo/repository-knowledge";

import type { LearnedNotice, LearnedNoticeEntry } from "./learned-notice-state.js";

const execute = promisify(execFile);
const MAXIMUM_COMMITS = 32;
const MAXIMUM_ENTRIES = 16;
const MAXIMUM_LINKS = 3;
const FIRST_RUN_WINDOW = "24 hours ago";

async function git(root: string, args: string[], maxBuffer = 1024 * 1024): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...args], { timeout: 10_000, maxBuffer });
  return stdout;
}

/** Each Lervo commit subject names why its outputs changed. */
function commitKind(subject: string): LearnedNoticeEntry["kind"] | null {
  if (subject === "docs: apply a reviewed owner rule") return "owner_rule";
  if (subject === "docs: apply reviewed canonical knowledge") return "canonical";
  if (subject === "docs: apply reviewed background knowledge") return "updated";
  return null;
}

function pathKind(
  kind: LearnedNoticeEntry["kind"],
  path: string,
): LearnedNoticeEntry["kind"] | null {
  if (path.startsWith(".agents/skills/")) return "skill";
  if (!/\.mdx?$/iu.test(path)) return null;
  // Generated indexes and publications restate other changes; they teach the owner nothing.
  if (path.startsWith(".lervo/") || /(^|\/)(index|_index)\.md$/iu.test(path)) return null;
  if (path.startsWith("docs/instructions/generated/")) return "owner_rule";
  return kind;
}

async function title(root: string, path: string): Promise<string | null> {
  try {
    const text = (await readFile(resolve(root, path), "utf8")).slice(0, 4096);
    const heading = /^#\s+(.+)$/mu.exec(text)?.[1]?.trim();
    return heading === undefined ? null : heading.slice(0, 80);
  } catch {
    return null;
  }
}

/** Repository-relative targets of Markdown links on the lines the commit added. */
async function addedLinks(root: string, commit: string, path: string): Promise<string[]> {
  const diff = await git(root, ["show", "--format=", "--unified=0", commit, "--", path]).catch(
    () => "",
  );
  const links = new Set<string>();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const match of line.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/gu)) {
      const target = match[1]!;
      if (/^[a-z]+:/iu.test(target) || target.startsWith("/")) continue;
      const normalized = posix.normalize(posix.join(posix.dirname(path), target));
      if (!normalized.startsWith("..")) links.add(normalized);
      if (links.size >= MAXIMUM_LINKS) return [...links];
    }
  }
  return [...links];
}

/**
 * ADR-0549: what Lervo committed after `shownThrough`, from Git alone, so every host that pulls the
 * owner host's commits computes the same notice. A first run looks back 24 hours.
 */
export async function projectLearnedNotice(input: {
  root: string;
  shownThrough: string | null;
  now: Date;
}): Promise<LearnedNotice | null> {
  let log: string;
  try {
    const range =
      input.shownThrough === null
        ? ["--since", FIRST_RUN_WINDOW, "HEAD"]
        : [`${input.shownThrough}..HEAD`];
    log = await git(input.root, [
      "log",
      `--max-count=${MAXIMUM_COMMITS}`,
      `--author=${LERVO_KNOWLEDGE_COMMIT_EMAIL}`,
      "--format=%x1e%H%x1f%s",
      "--name-only",
      "--no-renames",
      ...range,
    ]);
  } catch {
    // An unknown or unreachable cursor (rewritten history) restarts from the first-run window.
    if (input.shownThrough === null) return null;
    return projectLearnedNotice({ ...input, shownThrough: null });
  }
  const commits = log
    .split("\x1e")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const [header = "", ...paths] = block.split("\n");
      const [commit = "", subject = ""] = header.split("\x1f");
      return { commit, subject, paths: paths.filter((path) => path.length > 0) };
    });
  const seen = new Set<string>();
  const entries: LearnedNoticeEntry[] = [];
  const counts = { owner_rule: 0, skill: 0, canonical: 0, updated: 0 };
  // Newest first, so each path reports its latest reason.
  for (const { commit, subject, paths } of commits) {
    const kind = commitKind(subject);
    if (kind === null) continue;
    for (const path of paths) {
      const resolved = pathKind(kind, path);
      if (resolved === null) continue;
      const key = resolved === "skill" ? path.split("/").slice(0, 3).join("/") : path;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[resolved] += 1;
      if (entries.length >= MAXIMUM_ENTRIES) continue;
      entries.push({
        kind: resolved,
        path: key,
        title: resolved === "skill" ? (key.split("/")[2] ?? null) : await title(input.root, path),
        links: resolved === "canonical" ? await addedLinks(input.root, commit, path) : [],
      });
    }
  }
  return {
    schemaVersion: 1,
    observedAt: input.now.toISOString(),
    throughCommit: commits[0]?.commit ?? input.shownThrough,
    counts,
    entries,
  };
}
