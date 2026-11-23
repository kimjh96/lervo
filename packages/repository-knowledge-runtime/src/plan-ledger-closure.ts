import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProjectStorage } from "@lervo/project-storage";
import {
  parseClosedPlanItems,
  planItemOpen,
  resolvePlanItemReference,
  type ClosedPlanItem,
  type OpenPlanItemContext,
  type PlanItemEvidence,
} from "@lervo/repository-knowledge";

import {
  closePlanItem,
  PLAN_LEDGER_EVENT_SCHEMA_VERSION,
  readPlanLedger,
} from "./plan-ledger-store.js";

const execute = promisify(execFile);

/** How far evidence may predate its item: the turn that named the work can be queued this long. */
export const PLAN_EVIDENCE_LEAD_MS = 24 * 60 * 60 * 1000;
/** How many recent first-parent commits a pull request number is looked up in. */
const MERGE_SEARCH_DEPTH = 2_000;

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const output = (
      await execute("git", ["-C", root, ...args], { maxBuffer: 4 * 1024 * 1024 })
    ).stdout.trim();
    return output === "" ? null : output;
  } catch {
    return null;
  }
}

/**
 * The branch a merged pull request lands on: the remote's default branch, else `origin/main` or
 * `origin/master`. Without one, no pull request resolves: a topic branch is never evidence.
 */
async function integrationBranch(root: string): Promise<string | null> {
  const remoteHead = await git(root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (remoteHead?.startsWith("refs/remotes/") === true)
    return remoteHead.slice("refs/remotes/".length);
  for (const branch of ["origin/main", "origin/master"])
    if ((await git(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${branch}`])) !== null)
      return branch;
  return null;
}

/**
 * The commit that merged pull request `number` into `branch` and its commit time: the subject
 * GitHub writes for a merge commit or a squash merge, matched on the subject alone, following only
 * the branch's own first-parent history.
 */
async function pullRequestMerge(
  root: string,
  branch: string,
  number: number,
): Promise<{ commit: string; at: number } | null> {
  const log = await git(root, [
    "log",
    branch,
    "--first-parent",
    `--max-count=${MERGE_SEARCH_DEPTH}`,
    "--format=%H%x09%ct%x09%s",
  ]);
  const merge = new RegExp(`^Merge pull request #${number} from `, "u");
  const squash = new RegExp(` \\(#${number}\\)$`, "u");
  for (const line of log?.split("\n") ?? []) {
    const [commit, seconds, subject] = line.split("\t");
    if (commit === undefined || seconds === undefined || subject === undefined) continue;
    if (merge.test(subject) || squash.test(subject))
      return /^[a-f0-9]{40,64}$/u.test(commit) ? { commit, at: Number(seconds) * 1000 } : null;
  }
  return null;
}

/** The time a tag was made: the tagger date of an annotated tag, else its commit's time. */
async function tagTime(root: string, tag: string): Promise<number | null> {
  const seconds = await git(root, [
    "for-each-ref",
    "--format=%(if)%(taggerdate)%(then)%(taggerdate:unix)%(else)%(*committerdate:unix)%(committerdate:unix)%(end)",
    `refs/tags/${tag}`,
  ]);
  return seconds === null || !/^[0-9]+$/u.test(seconds) ? null : Number(seconds) * 1000;
}

/**
 * Whether the exchange itself names the evidence: a pull request as `#N`, `PR N`, or `/pull/N`, a
 * release as its exact tag. The provider may only point at evidence the turn states; it never
 * supplies its own.
 */
function exchangeNames(exchange: string, close: ClosedPlanItem): boolean {
  if (close.pullRequest !== null)
    return new RegExp(`(?:#|\\bPR\\s*#?|/pull/)${close.pullRequest}(?![0-9])`, "iu").test(exchange);
  if (close.release === null) return false;
  const tag = close.release.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9._/-])${tag}(?![A-Za-z0-9_/-]|\\.[A-Za-z0-9])`, "u").test(
    exchange,
  );
}

/**
 * The evidence Lervo itself checks for a proposed close, or null when nothing can be observed, the
 * exchange does not name it, or it predates the item by more than the queue lead.
 */
async function observableEvidence(
  root: string,
  close: ClosedPlanItem,
  exchange: string,
  capturedAt: number,
): Promise<PlanItemEvidence | null> {
  if (!exchangeNames(exchange, close) || !Number.isFinite(capturedAt)) return null;
  const earliest = capturedAt - PLAN_EVIDENCE_LEAD_MS;
  if (close.release !== null) {
    const at = await tagTime(root, close.release);
    return at === null || at < earliest
      ? null
      : { kind: "release", ref: close.release, branch: null };
  }
  const branch = await integrationBranch(root);
  if (branch === null || close.pullRequest === null) return null;
  const merge = await pullRequestMerge(root, branch, close.pullRequest);
  return merge === null || merge.at < earliest
    ? null
    : { kind: "commit", ref: merge.commit, branch };
}

export interface PlanItemClosureResult {
  status: "closed" | "inactive" | "invalid";
  closedCount: number;
}

/**
 * ADR-0563: closes the shown open items an owner-turn assessment reports as finished or replaced.
 * A close is permanent, so each one is grounded:
 * - `done` closes only with evidence the exchange itself names and Lervo observes: a release tag,
 *   or the merge commit of a pull request on the integration branch, recorded as that commit, no
 *   older than the item allows. A statement alone never closes an item.
 * - One pull request or tag closes at most one item per response.
 * - `superseded` closes only for another shown item that stays open after this response, so two
 *   items never replace each other and the work never disappears.
 * - A reference names only an item the assessment was shown, never a ledger id.
 * Before schema 9 is active nothing is written; a close that fails skips that item only.
 */
export async function closePlanItemsFromAssessment(input: {
  storage: ProjectStorage;
  repositoryRoot: string;
  response: unknown;
  shown: readonly OpenPlanItemContext[];
  /** The owner turn and the preceding agent turn the assessment read. */
  exchange: readonly (string | null)[];
  now: Date;
}): Promise<PlanItemClosureResult> {
  if ((input.storage.writableEventSchemaVersion ?? 1) < PLAN_LEDGER_EVENT_SCHEMA_VERSION)
    return { status: "inactive", closedCount: 0 };
  let closes: ClosedPlanItem[];
  try {
    closes = parseClosedPlanItems(
      (input.response as { closedPlanItems?: unknown } | null)?.closedPlanItems,
    );
  } catch {
    return { status: "invalid", closedCount: 0 };
  }
  const exchange = input.exchange.filter((text): text is string => text !== null).join("\n");
  const resolved = closes.flatMap((close) => {
    const item = resolvePlanItemReference(input.shown, close.reference);
    return item === null ? [] : [{ close, item }];
  });
  // A replacement must survive this response: one that this response also closes is no replacement.
  const closing = new Set(resolved.map(({ item }) => item.itemId));
  // One merged pull request or tag finishes one piece of work: it closes one item per response.
  const used = new Set<string>();
  let closedCount = 0;
  for (const { close, item } of resolved) {
    try {
      const current = readPlanLedger(input.storage).items.get(item.itemId);
      if (current === undefined || !planItemOpen(current)) continue;
      if (close.state === "done") {
        const key =
          close.pullRequest === null ? `release:${close.release}` : `pull:${close.pullRequest}`;
        if (used.has(key)) continue;
        const evidence = await observableEvidence(
          input.repositoryRoot,
          close,
          exchange,
          Date.parse(current.capturedAt),
        );
        if (evidence === null) continue;
        used.add(key);
        await closePlanItem(input.storage, {
          repositoryRoot: input.repositoryRoot,
          itemId: item.itemId,
          state: "done",
          reason: "The exchange finished this work.",
          evidence: [evidence],
          now: input.now,
        });
      } else {
        const replacement = resolvePlanItemReference(input.shown, close.supersededBy);
        if (replacement === null || closing.has(replacement.itemId)) continue;
        const live = readPlanLedger(input.storage).items.get(replacement.itemId);
        if (live === undefined || !planItemOpen(live)) continue;
        await closePlanItem(input.storage, {
          repositoryRoot: input.repositoryRoot,
          itemId: item.itemId,
          state: "superseded",
          reason: "The exchange replaced this work.",
          supersededBy: replacement.itemId,
          now: input.now,
        });
      }
      closedCount += 1;
    } catch {
      // Unverified evidence, an item closed meanwhile, or a failed write skips this item only.
    }
  }
  return { status: "closed", closedCount };
}
