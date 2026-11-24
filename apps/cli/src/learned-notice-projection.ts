import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { promisify } from "node:util";

import { readEffectNotices } from "@lervo/project";
import { LERVO_KNOWLEDGE_COMMIT_EMAIL } from "@lervo/repository-knowledge";

import { withJournalNotices } from "./learned-notice-journal.js";
import type {
  LearnedEffectNotice,
  LearnedNotice,
  LearnedNoticeEntry,
} from "./learned-notice-state.js";

const execute = promisify(execFile);
/** Commits itemized per notice; older ones in the range are counted, never revisited. */
const MAXIMUM_COMMITS = 500;
const MAXIMUM_ENTRIES = 16;
const MAXIMUM_LINKS = 3;
const FIRST_RUN_WINDOW = "24 hours ago";
const MAXIMUM_TARGETS = 8;
const GENERATED_RULES = "docs/instructions/generated/";

async function git(root: string, args: string[], maxBuffer = 1024 * 1024): Promise<string> {
  // Unquoted paths keep non-ASCII names, such as Korean document titles, classifiable.
  const { stdout } = await execute("git", ["-C", root, "-c", "core.quotePath=false", ...args], {
    timeout: 10_000,
    maxBuffer,
  });
  return stdout;
}

/**
 * ADR-0561: a commit trailer records who agreed as one line, either `agreement 2/2 (claude run;
 * codex run)`, `<reviewer> agreed`, or `<reviewer> approved`; anything else is kept as the verdict
 * with no reviewer.
 */
export function parseCrossCheckTrailer(value: string): LearnedEffectNotice["crossCheck"] {
  const text = value.trim() || "unrecorded";
  const rounds = /^agreement \d+\/\d+ \((.*)\)$/u.exec(text);
  if (rounds !== null)
    return {
      reviewers: rounds[1]!.split("; ").filter((reviewer) => reviewer.length > 0),
      verdict: "agree",
    };
  const single = /^(.+) (?:agreed|approved)$/u.exec(text);
  if (single !== null) return { reviewers: [single[1]!], verdict: "agree" };
  return { reviewers: [], verdict: text };
}

/**
 * ADR-0561: a freshness apply commit names its document in the subject and carries the notice
 * fields as trailers; one entry reports the whole commit, however many paths an archive touched.
 */
function freshnessEntry(
  subject: string,
  trailers: { candidate: string; reason: string; crossCheck: string },
  targets: string[],
): LearnedNoticeEntry | null {
  const refresh = /^docs: refresh (.+) from evidence$/u.exec(subject);
  const archive = /^docs: archive (.+) as historical$/u.exec(subject);
  // ADR-0631: a reverse header commit names the record's ADR; its one target is the record.
  const reverse = /^docs: add reverse header lines to ADR-\d{3,5}$/u.test(subject);
  const path = refresh?.[1] ?? archive?.[1] ?? (reverse ? targets[0] : undefined);
  if (path === undefined || !/^kfresh_[a-f0-9]{24}$/u.test(trailers.candidate)) return null;
  return {
    kind: "freshness",
    path,
    title: null,
    links: [],
    freshness: {
      effect: archive === null ? "refresh" : "archive",
      targets,
      reason: trailers.reason || "unrecorded",
      crossCheck: parseCrossCheckTrailer(trailers.crossCheck),
      undo: `lervo knowledge freshness revert ${trailers.candidate}`,
    },
  };
}

/**
 * ADR-0561: a cross-checked effect commit (layout, migration, normalization, structure) carries its
 * notice fields as trailers; one entry reports the whole commit with its undo command.
 */
function effectEntry(
  commit: string,
  trailers: { effect: string; effectReason: string; effectCrossCheck: string },
  targets: string[],
): LearnedNoticeEntry | null {
  if (!/^[a-z_]{1,40}$/u.test(trailers.effect)) return null;
  return {
    kind: "effect",
    path: `${trailers.effect}@${commit.slice(0, 12)}`,
    title: null,
    links: [],
    effect: {
      effect: trailers.effect,
      targets,
      reason: trailers.effectReason || "unrecorded",
      crossCheck: parseCrossCheckTrailer(trailers.effectCrossCheck),
      undo: `lervo knowledge revert ${commit}`,
    },
  };
}

/** Each Lervo commit subject names why its outputs changed. */
function commitKind(subject: string): LearnedNoticeEntry["kind"] | null {
  // ADR-0561 renamed the owner-rule subjects; the reviewed form remains in older history.
  if (
    subject === "docs: apply an owner rule" ||
    subject === "docs: retire an owner rule" ||
    subject === "docs: apply a reviewed owner rule"
  )
    return "owner_rule";
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
  /** The newest journal notice already shown; null on a first run. */
  noticesShownThrough?: string | null;
  now: Date;
}): Promise<LearnedNotice | null> {
  const commits = await projectCommitNotice(input);
  if (commits === null) return null;
  return withJournalNotices(
    commits,
    await readEffectNotices(input.root),
    input.noticesShownThrough ?? null,
    input.now,
  );
}

async function projectCommitNotice(input: {
  root: string;
  shownThrough: string | null;
  now: Date;
}): Promise<LearnedNotice | null> {
  // A cursor that is not an ancestor of HEAD (rewritten or switched history) restarts from the
  // first-run window instead of reporting another branch's commits.
  const reachable =
    input.shownThrough !== null &&
    (await git(input.root, ["merge-base", "--is-ancestor", input.shownThrough, "HEAD"]).then(
      () => true,
      () => false,
    ));
  let log: string;
  let head: string;
  let omittedCommits: number;
  try {
    // The notice covers the whole range up to this HEAD, and the cursor then moves to HEAD. A
    // single-commit cursor inside merged histories could otherwise revisit a parallel branch.
    head = (await git(input.root, ["rev-parse", "HEAD"])).trim();
    const range = reachable
      ? [`${input.shownThrough}..${head}`]
      : ["--since", FIRST_RUN_WINDOW, head];
    const all = (
      await git(
        input.root,
        ["rev-list", `--author=${LERVO_KNOWLEDGE_COMMIT_EMAIL}`, ...range],
        16 * 1024 * 1024,
      )
    )
      .split("\n")
      .filter((commit) => /^[a-f0-9]{40,64}$/u.test(commit));
    // rev-list lists newest first; the newest commits are itemized and the rest are counted.
    const batch = all.slice(0, MAXIMUM_COMMITS);
    omittedCommits = all.length - batch.length;
    if (batch.length === 0) return emptyNotice(input.now, head);
    log = await git(
      input.root,
      [
        "log",
        "--no-walk=unsorted",
        "--format=%x1e%H%x1f%s%x1f%(trailers:key=Lervo-Freshness-Candidate,valueonly,separator=%x1d)%x1f%(trailers:key=Lervo-Freshness-Reason,valueonly,separator=%x1d)%x1f%(trailers:key=Lervo-Freshness-Cross-Check,valueonly,separator=%x1d)%x1f%(trailers:key=Lervo-Effect,valueonly,separator=%x1d)%x1f%(trailers:key=Lervo-Effect-Reason,valueonly,separator=%x1d)%x1f%(trailers:key=Lervo-Effect-Cross-Check,valueonly,separator=%x1d)",
        "--name-status",
        "--no-renames",
        ...batch,
      ],
      16 * 1024 * 1024,
    );
  } catch {
    return null;
  }
  const commits = log
    .split("\x1e")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const [header = "", ...lines] = block.split("\n");
      const [
        commit = "",
        subject = "",
        candidate = "",
        reason = "",
        crossCheck = "",
        effect = "",
        effectReason = "",
        effectCrossCheck = "",
      ] = header.split("\x1f");
      const changes = lines
        .map((line) => /^([A-Z])[0-9]*\t(.+)$/u.exec(line))
        .filter((match) => match !== null)
        .map((match) => ({ deleted: match[1] === "D", path: match[2]! }));
      const ruleDeletions = changes
        .filter((change) => change.deleted && change.path.startsWith(GENERATED_RULES))
        .map((change) => change.path);
      const trailers = {
        candidate: candidate.trim(),
        reason: reason.trim(),
        crossCheck: crossCheck.trim(),
        effect: effect.trim(),
        effectReason: effectReason.trim(),
        effectCrossCheck: effectCrossCheck.trim(),
      };
      return { commit, subject, changes, ruleDeletions, trailers };
    });
  const seen = new Set<string>();
  const entries: LearnedNoticeEntry[] = [];
  const counts = { owner_rule: 0, skill: 0, canonical: 0, freshness: 0, effect: 0, updated: 0 };
  // Newest first, so each path reports its latest reason.
  for (const { commit, subject, changes, ruleDeletions, trailers } of commits) {
    const targets = changes.slice(0, MAXIMUM_TARGETS).map((change) => change.path);
    const freshness = freshnessEntry(subject, trailers, targets);
    if (freshness !== null) {
      if (seen.has(freshness.path)) continue;
      seen.add(freshness.path);
      counts.freshness += 1;
      if (entries.length < MAXIMUM_ENTRIES) entries.push(freshness);
      continue;
    }
    const effectNotice = effectEntry(commit, trailers, targets);
    if (effectNotice !== null) {
      counts.effect += 1;
      if (entries.length < MAXIMUM_ENTRIES) entries.push(effectNotice);
      continue;
    }
    const kind = commitKind(subject);
    if (kind === null) continue;
    // A rule stored in the same commit carries the rules it replaced; otherwise a deleted rule
    // was retired and is itemized on its own.
    const storesRule = changes.some(
      (change) => !change.deleted && change.path.startsWith(GENERATED_RULES),
    );
    for (const { deleted, path } of changes) {
      if (deleted && (storesRule || !path.startsWith(GENERATED_RULES))) continue;
      const resolved = pathKind(kind, path);
      if (resolved === null) continue;
      const key = resolved === "skill" ? path.split("/").slice(0, 3).join("/") : path;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[resolved] += 1;
      if (entries.length >= MAXIMUM_ENTRIES) continue;
      const replaced =
        resolved === "owner_rule" && !deleted && ruleDeletions.length > 0 ? ruleDeletions : [];
      entries.push({
        kind: resolved,
        path: key,
        title:
          resolved === "skill"
            ? (key.split("/")[2] ?? null)
            : deleted
              ? null
              : await title(input.root, path),
        links: resolved === "canonical" ? await addedLinks(input.root, commit, path) : [],
        ...(replaced.length > 0 ? { replaced } : {}),
        ...(deleted ? { retired: true as const } : {}),
      });
    }
  }
  return {
    schemaVersion: 1,
    observedAt: input.now.toISOString(),
    // Everything up to this HEAD is covered, so the next notice starts here.
    throughCommit: head,
    ...(omittedCommits > 0 ? { omittedCommits } : {}),
    counts,
    entries,
  };
}

function emptyNotice(now: Date, throughCommit: string | null): LearnedNotice {
  return {
    schemaVersion: 1,
    observedAt: now.toISOString(),
    throughCommit,
    counts: { owner_rule: 0, skill: 0, canonical: 0, freshness: 0, effect: 0, updated: 0 },
    entries: [],
  };
}
