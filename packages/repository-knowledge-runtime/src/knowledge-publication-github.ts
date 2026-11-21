import {
  type KnowledgePublicationForge,
  type KnowledgePublicationHistoryEntry,
  type KnowledgePublicationPullRequest,
} from "./knowledge-publication-forge.js";
import { summarizeKnowledgePublicationChecks } from "./knowledge-publication-github-checks.js";
import {
  githubRepositoryOnce,
  resolveGitHubRepositoryDetail,
  type ResolvedGitHubRepository,
  scopeGitHubArguments,
} from "./knowledge-publication-github-repository.js";
import { markKnowledgePublicationClosed } from "./knowledge-publication-history.js";
import {
  ghRunner,
  guarded,
  InvalidResponse,
  type Runner,
} from "./knowledge-publication-github-cli.js";
import { jsonLines, mergeGate, readGitHubPolicy } from "./knowledge-publication-github-policy.js";
import { reduceKnowledgePublicationPolicy } from "./knowledge-publication-policy.js";

export {
  classifyGitHubCliFailure,
  githubFailureReason,
} from "./knowledge-publication-github-cli.js";
export { mergeGate } from "./knowledge-publication-github-policy.js";
export { summarizeKnowledgePublicationChecks } from "./knowledge-publication-github-checks.js";

const PULL_REQUEST_FIELDS = "number,url,state,headRefOid,title,body,mergeCommit";

function pullRequest(value: unknown): KnowledgePublicationPullRequest {
  const item = value as Record<string, unknown> | null;
  const state = String(item?.state ?? "").toLowerCase();
  if (
    item === null ||
    !Number.isSafeInteger(item.number) ||
    typeof item.url !== "string" ||
    typeof item.headRefOid !== "string" ||
    (state !== "open" && state !== "merged" && state !== "closed")
  )
    throw new InvalidResponse("The GitHub pull request response is invalid.");
  return {
    number: item.number as number,
    url: item.url,
    state,
    headSha: item.headRefOid,
    title: typeof item.title === "string" ? item.title : "",
    body: typeof item.body === "string" ? item.body : "",
    mergeCommit:
      typeof (item.mergeCommit as { oid?: unknown } | null)?.oid === "string"
        ? (item.mergeCommit as { oid: string }).oid
        : null,
  };
}

const RECORD_START = "<!-- lervo-publication-record";
/**
 * ADR-0603: each closed pull request with only the record block of its body, so the paginated
 * history stays small. `merge_commit_sha` names a test merge on an unmerged pull request, so only
 * `merged_at` says it merged.
 */
const HISTORY_JQ = `.[] | {number, merged: (.merged_at != null), mergeCommit: (if .merged_at == null then null else .merge_commit_sha end), mergedAt: .merged_at, updatedAt: .updated_at, open: (.state == "open"), headSha: .head.sha, record: ((.body // "") | split("${RECORD_START}") | if length > 1 then "${RECORD_START}" + .[-1] else "" end)}`;
const COMMIT = /^[0-9a-f]{40,64}$/u;

function historyEntry(value: unknown): KnowledgePublicationHistoryEntry {
  const item = value as Partial<KnowledgePublicationHistoryEntry> | null;
  if (
    item === null ||
    typeof item !== "object" ||
    !Number.isSafeInteger(item.number) ||
    typeof item.merged !== "boolean" ||
    typeof item.headSha !== "string" ||
    !COMMIT.test(item.headSha) ||
    !(
      item.mergeCommit === null ||
      (typeof item.mergeCommit === "string" && COMMIT.test(item.mergeCommit))
    ) ||
    !(
      item.mergedAt === null ||
      (typeof item.mergedAt === "string" && ISO_TIMESTAMP.test(item.mergedAt))
    ) ||
    typeof item.updatedAt !== "string" ||
    !ISO_TIMESTAMP.test(item.updatedAt) ||
    typeof item.record !== "string"
  )
    throw new InvalidResponse("The GitHub pull request history is invalid.");
  return {
    number: item.number!,
    merged: item.merged,
    headSha: item.headSha,
    mergeCommit: item.mergeCommit ?? null,
    mergedAt: item.mergedAt ?? null,
    updatedAt: item.updatedAt,
    record: item.record,
    ...(item.open === true ? { open: true } : {}),
  };
}

/** GitHub closes a pull request whose head branch was deleted at about the same moment. */
const BRANCH_DELETION_WINDOW_MS = 60_000;

/**
 * ADR-0607: how a pull request was last closed. A close at most a minute after a deletion of its
 * head branch is GitHub's, after a person deleted the branch; any other close, including one a
 * person made just before deleting the branch, is a person's decision.
 */
export function closureCause(events: readonly unknown[]): "person" | "branch_deleted" {
  const items = events
    .map((value) => value as { event?: unknown; created_at?: unknown } | null)
    .filter((item) => typeof item?.event === "string" && typeof item.created_at === "string")
    .map((item) => ({ event: item!.event as string, at: Date.parse(item!.created_at as string) }));
  const closed = items.filter((item) => item.event === "closed").at(-1);
  if (closed === undefined || Number.isNaN(closed.at)) return "person";
  // Only a deletion at or before the close closed it; a person who closed it and then deleted
  // the branch decided first.
  return items.some(
    (item) =>
      item.event === "head_ref_deleted" &&
      item.at <= closed.at &&
      closed.at - item.at <= BRANCH_DELETION_WINDOW_MS,
  )
    ? "branch_deleted"
    : "person";
}

/** ADR-0603: the merge gate, with the draft flag and merge queue `gh pr view` does not report. */
const GATE_QUERY =
  "query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){mergeStateStatus reviewDecision isDraft isInMergeQueue isMergeQueueEnabled}}}";

/** GitHub's refusal to rerun a workflow run that is too old to retry. */
const RERUN_EXPIRED =
  /created over a month ago|older than (?:a month|30 days)|(?:is )?not retryable/iu;

/** GitHub retries a workflow run only within a month of its creation. */
const RERUN_WINDOW_MILLISECONDS = 30 * 24 * 60 * 60_000;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

function rerunExpired(error: unknown): boolean {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  return RERUN_EXPIRED.test(typeof stderr === "string" ? stderr : String(stderr ?? ""));
}

/**
 * GitHub through the host's authenticated `gh` CLI. It uses whatever credential that host already
 * has; it never reads or stores a token itself.
 */
export function createGitHubKnowledgePublicationForge(input: {
  repositoryRoot: string;
  executable?: string;
  run?: Runner;
  now?: () => Date;
  /**
   * ADR-0603: `owner/name` every gh call targets. Absent resolves it from the publication remote;
   * null leaves gh's own resolution, only for an injected runner in tests.
   */
  repository?: string | null;
  /** Pull requests per history page; GitHub allows at most 100. */
  historyPageSize?: number;
  /** How the repository is resolved when `repository` is absent; replaced only in tests. */
  resolveRepository?: (root: string) => Promise<ResolvedGitHubRepository>;
}): KnowledgePublicationForge {
  const pageSize = input.historyPageSize ?? 100;
  const raw = input.run ?? ghRunner(input.repositoryRoot, input.executable ?? "gh");
  const repository = githubRepositoryOnce({
    root: input.repositoryRoot,
    fixed:
      input.repository !== undefined
        ? input.repository
        : input.run !== undefined
          ? null
          : undefined,
    resolve:
      input.resolveRepository ??
      ((root) => resolveGitHubRepositoryDetail(root, { executable: input.executable ?? "gh" })),
    now: input.now ?? (() => new Date()),
  });
  const run: Runner = async (args, stdin) => {
    const target = await repository();
    return raw(target === null ? args : scopeGitHubArguments(args, target), stdin);
  };
  const now = input.now ?? (() => new Date());
  // The run's age decides expiry: `gh` words the refusal differently by version (2.46 calls it a
  // broken workflow file), so the refusal text is only a fallback. An unreadable age tries the rerun.
  const outsideRerunWindow = async (id: number) => {
    const createdAt = await run([
      "api",
      `repos/{owner}/{repo}/actions/runs/${id}`,
      "--jq",
      ".created_at",
    ]).then(
      (output) => (ISO_TIMESTAMP.test(output.trim()) ? Date.parse(output.trim()) : Number.NaN),
      () => Number.NaN,
    );
    return Number.isFinite(createdAt) && now().getTime() - createdAt > RERUN_WINDOW_MILLISECONDS;
  };
  const view = async (number: number) =>
    pullRequest(
      JSON.parse(await run(["pr", "view", String(number), "--json", PULL_REQUEST_FIELDS])),
    );
  // ADR-0603: before Lervo closes a pull request itself, its record says so, so the closure never
  // reads as a person's decision on another host.
  const markClosed = async (number: number, reason: string) => {
    const { body } = JSON.parse(await run(["pr", "view", String(number), "--json", "body"])) as {
      body?: unknown;
    };
    if (typeof body !== "string") throw new InvalidResponse("The pull request body is invalid.");
    const marked = markKnowledgePublicationClosed(body, reason);
    if (marked !== body)
      await run(
        ["api", "--method", "PATCH", `repos/{owner}/{repo}/pulls/${number}`, "--input", "-"],
        JSON.stringify({ body: marked }),
      );
  };
  return {
    findPullRequest: ({ head, base }) =>
      guarded("find", async () => {
        const list = JSON.parse(
          await run([
            "pr",
            "list",
            "--head",
            head,
            "--base",
            base,
            "--state",
            "open",
            "--limit",
            "20",
            "--json",
            `${PULL_REQUEST_FIELDS},isCrossRepository`,
          ]),
        ) as unknown[];
        if (!Array.isArray(list))
          throw new InvalidResponse("The GitHub pull request list is invalid.");
        // ADR-0603: `--head` matches a branch name in any fork; only the pull request from this
        // repository's own publication branch counts.
        const own = list.find(
          (item) => (item as { isCrossRepository?: unknown } | null)?.isCrossRepository === false,
        );
        return own === undefined ? null : pullRequest(own);
      }),
    createPullRequest: ({ head, base, title, body }) =>
      guarded("create", async () => {
        const url = (
          await run(
            ["pr", "create", "--head", head, "--base", base, "--title", title, "--body-file", "-"],
            body,
          )
        ).trim();
        const number = Number(/\/pull\/(\d+)$/u.exec(url)?.[1]);
        if (!Number.isSafeInteger(number))
          throw new InvalidResponse("The created pull request is unknown.");
        return view(number);
      }),
    updatePullRequest: ({ number, title, body }) =>
      guarded("update", async () => {
        // The REST endpoint avoids `gh pr edit`, which fails on older gh releases while it reads the
        // retired Projects (classic) field before editing.
        await run(
          ["api", "--method", "PATCH", `repos/{owner}/{repo}/pulls/${number}`, "--input", "-"],
          JSON.stringify({ title, body }),
        );
      }),
    viewPullRequest: (number) => guarded("view", () => view(number)),
    // ADR-0607: newest change first, page by page, stopping once a page reaches back past `since`.
    publicationHistory: ({ head, base, since }) =>
      guarded("history", async () => {
        const entries: KnowledgePublicationHistoryEntry[] = [];
        for (let page = 1; ; page++) {
          const items = jsonLines(
            await run([
              "api",
              `repos/{owner}/{repo}/pulls?state=all&head={owner}:${encodeURIComponent(head)}&base=${encodeURIComponent(base)}&sort=updated&direction=desc&per_page=${pageSize}&page=${page}`,
              "--jq",
              HISTORY_JQ,
            ]),
          ).map(historyEntry);
          entries.push(...items);
          if (items.length < pageSize) break;
          if (since !== undefined && items.at(-1)!.updatedAt < since) break;
        }
        return entries;
      }),
    repository: async () => (await repository()) ?? "default",
    closureCause: (number) =>
      guarded("history", async () =>
        closureCause(
          jsonLines(
            await run([
              "api",
              "--paginate",
              `repos/{owner}/{repo}/issues/${number}/events?per_page=100`,
              "--jq",
              ".[] | {event, created_at}",
            ]),
          ),
        ),
      ),
    closePullRequest: ({ number, comment }) =>
      guarded("close", async () => {
        await markClosed(number, "superseded");
        await run(["pr", "close", String(number), "--comment", comment]);
      }),
    checks: ({ number, headSha, ignore, required }) =>
      guarded("checks", async () => {
        const value = JSON.parse(
          await run(["pr", "view", String(number), "--json", "headRefOid,statusCheckRollup"]),
        ) as { headRefOid?: unknown; statusCheckRollup?: unknown };
        const summary = summarizeKnowledgePublicationChecks({
          headSha,
          observedHeadSha: String(value.headRefOid ?? ""),
          rollup: value.statusCheckRollup,
          ...(ignore === undefined ? {} : { ignore }),
          ...(required === undefined ? {} : { required }),
        });
        if (summary.state !== "failed") return summary;
        // The rollup times a job GitHub refused to start like a real one, so its steps tell.
        const failures = await Promise.all(
          summary.failures.map(async (failure) => {
            if (failure.jobId === null || failure.conclusion !== "failure") return failure;
            const steps = await run([
              "api",
              `repos/{owner}/{repo}/actions/jobs/${failure.jobId}`,
              "--jq",
              ".steps | length",
            ])
              .then((output) => Number(output.trim()))
              .catch(() => Number.NaN);
            return steps === 0 ? { ...failure, conclusion: "not_run" } : failure;
          }),
        );
        return { ...summary, failures };
      }),
    rerunFailedChecks: ({ number, runIds }) =>
      guarded("rerun", async () => {
        // GitHub refuses to rerun a run older than a month; reopening retriggers it instead.
        // Any other refusal fails the step, and nothing is closed.
        let expired = false;
        for (const id of runIds) {
          if (await outsideRerunWindow(id)) {
            expired = true;
            continue;
          }
          await run(["run", "rerun", String(id), "--failed"]).catch((error: unknown) => {
            if (!rerunExpired(error)) throw error;
            expired = true;
          });
        }
        if (!expired) return;
        // The next publication renders the body again, which drops the mark once it reopened.
        await markClosed(number, "rerun");
        await run(["pr", "close", String(number)]);
        await run(["pr", "reopen", String(number)]).catch(() =>
          run(["pr", "reopen", String(number)]),
        );
      }),
    merge: ({ number, headSha, method }) =>
      guarded("merge", async () => {
        // A merge queue merges with its own method; gh enqueues when no method is given.
        await run([
          "pr",
          "merge",
          String(number),
          ...(method === "queue" ? [] : [`--${method}`]),
          "--match-head-commit",
          headSha,
        ]);
      }),
    policy: ({ base, branch }) =>
      guarded("policy", async () =>
        reduceKnowledgePublicationPolicy(await readGitHubPolicy(run, base, branch)),
      ),
    gate: (number) =>
      guarded("gate", async () => {
        const value = JSON.parse(
          await run([
            "api",
            "graphql",
            "-F",
            "owner={owner}",
            "-F",
            "repo={repo}",
            "-F",
            `number=${number}`,
            "-f",
            `query=${GATE_QUERY}`,
          ]),
        ) as { data?: { repository?: { pullRequest?: Record<string, unknown> | null } } };
        const pull = value?.data?.repository?.pullRequest;
        if (pull === null || pull === undefined || typeof pull !== "object")
          throw new InvalidResponse("The GitHub merge state is invalid.");
        return mergeGate(pull.mergeStateStatus, pull.reviewDecision, pull);
      }),
  };
}
