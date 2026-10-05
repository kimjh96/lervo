import { execFile } from "node:child_process";

import {
  KnowledgePublicationForgeError,
  type KnowledgePublicationChecks,
  type KnowledgePublicationForge,
  type KnowledgePublicationForgeFailureClass,
  type KnowledgePublicationForgeOperation,
  type KnowledgePublicationPullRequest,
} from "./knowledge-publication-forge.js";

const PULL_REQUEST_FIELDS = "number,url,state,headRefOid,title,body";

type Runner = (args: string[], input?: string) => Promise<string>;

function ghRunner(root: string, executable: string): Runner {
  return (args, input) =>
    new Promise((resolveRun, reject) => {
      const child = execFile(
        executable,
        args,
        {
          cwd: root,
          maxBuffer: 4 * 1024 * 1024,
          timeout: 60_000,
          env: { ...process.env, GH_PROMPT_DISABLED: "1" },
        },
        (error, stdout, stderr) =>
          error === null ? resolveRun(stdout) : reject(Object.assign(error, { stderr })),
      );
      if (input !== undefined) child.stdin?.end(input);
    });
}

class InvalidResponse extends Error {}

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
  };
}

// Ordered: the first matching class wins, so a refused merge names its most specific cause.
const STDERR_CLASSES: readonly [KnowledgePublicationForgeFailureClass, RegExp][] = [
  [
    "checks_pending",
    /status checks? .*(?:expected|pending|in progress|queued)|checks? (?:are |is )?(?:still )?(?:pending|in progress|queued)|waiting (?:for|on) (?:status )?checks?/iu,
  ],
  ["checks_failed", /status checks? .*(?:fail|error)|checks? (?:have |has )?failed/iu],
  [
    "not_mergeable",
    /not mergeable|merge conflict|cannot be merged|head branch was modified|head branch is out of date|base branch policy|match-head-commit|expected head/iu,
  ],
  [
    "auth",
    /authenticat|gh auth login|bad credentials|HTTP 40[13]|forbidden|permission|must have (?:push|write|admin)|not logged in|resource not accessible/iu,
  ],
  [
    "network",
    /could not resolve host|connection|timed? ?out|timeout|network|ECONN|ENOTFOUND|EAI_AGAIN|TLS|HTTP 5\d\d|unexpected EOF|i\/o/iu,
  ],
  ["not_found", /not found|could not find|could not resolve to|no pull requests? found|HTTP 404/iu],
];

/**
 * Reduces one `gh` failure to a closed class. Only the class, exit code, and operation are kept;
 * stderr can carry repository names, URLs, or account names and never leaves this function.
 */
export function classifyGitHubCliFailure(error: unknown): {
  exitCode: number | null;
  failureClass: KnowledgePublicationForgeFailureClass;
} {
  if (error instanceof InvalidResponse || error instanceof SyntaxError)
    return { exitCode: null, failureClass: "invalid_response" };
  const value = (error ?? {}) as {
    code?: unknown;
    killed?: unknown;
    signal?: unknown;
    stderr?: unknown;
  };
  if (value.code === "ENOENT") return { exitCode: null, failureClass: "not_installed" };
  const exitCode = typeof value.code === "number" ? value.code : null;
  if (value.killed === true || value.signal === "SIGTERM")
    return { exitCode, failureClass: "network" };
  const stderr = typeof value.stderr === "string" ? value.stderr : String(value.stderr ?? "");
  const match = STDERR_CLASSES.find(([, pattern]) => pattern.test(stderr));
  return { exitCode, failureClass: match?.[0] ?? "unknown" };
}

async function guarded<T>(
  operation: KnowledgePublicationForgeOperation,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof KnowledgePublicationForgeError) throw error;
    const { exitCode, failureClass } = classifyGitHubCliFailure(error);
    throw new KnowledgePublicationForgeError(operation, exitCode, failureClass, { cause: error });
  }
}

/**
 * Reduces a status rollup for one exact head; a moved head is still pending. Only success
 * passes. A skipped check did not run for this pull request, so it neither passes nor blocks;
 * every other finished conclusion, including neutral and cancelled, fails.
 */
export function summarizeKnowledgePublicationChecks(input: {
  headSha: string;
  observedHeadSha: string;
  rollup: unknown;
}): KnowledgePublicationChecks {
  const items = Array.isArray(input.rollup) ? (input.rollup as Record<string, unknown>[]) : [];
  if (input.observedHeadSha !== input.headSha || items.length === 0)
    return { state: "pending", total: items.length };
  let failed = 0;
  let succeeded = 0;
  for (const item of items) {
    const conclusion =
      item.__typename === "StatusContext"
        ? String(item.state ?? "")
        : String(item.status ?? "") === "COMPLETED"
          ? String(item.conclusion ?? "")
          : "";
    if (conclusion === "" || conclusion === "PENDING" || conclusion === "EXPECTED")
      return { state: "pending", total: items.length };
    if (conclusion === "SUCCESS") succeeded++;
    else if (conclusion !== "SKIPPED") failed++;
  }
  if (failed > 0) return { state: "failed", total: items.length, failed };
  return succeeded === 0
    ? { state: "pending", total: items.length }
    : { state: "passed", total: items.length };
}

/**
 * GitHub through the host's authenticated `gh` CLI. It uses whatever credential that host already
 * has; it never reads or stores a token itself.
 */
export function createGitHubKnowledgePublicationForge(input: {
  repositoryRoot: string;
  executable?: string;
  run?: Runner;
}): KnowledgePublicationForge {
  const run = input.run ?? ghRunner(input.repositoryRoot, input.executable ?? "gh");
  const view = async (number: number) =>
    pullRequest(
      JSON.parse(await run(["pr", "view", String(number), "--json", PULL_REQUEST_FIELDS])),
    );
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
            "2",
            "--json",
            PULL_REQUEST_FIELDS,
          ]),
        ) as unknown[];
        if (!Array.isArray(list))
          throw new InvalidResponse("The GitHub pull request list is invalid.");
        return list.length === 0 ? null : pullRequest(list[0]);
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
        await run(["pr", "edit", String(number), "--title", title, "--body-file", "-"], body);
      }),
    viewPullRequest: (number) => guarded("view", () => view(number)),
    closePullRequest: ({ number, comment }) =>
      guarded("close", async () => {
        await run(["pr", "close", String(number), "--comment", comment]);
      }),
    checks: ({ number, headSha }) =>
      guarded("checks", async () => {
        const value = JSON.parse(
          await run(["pr", "view", String(number), "--json", "headRefOid,statusCheckRollup"]),
        ) as { headRefOid?: unknown; statusCheckRollup?: unknown };
        return summarizeKnowledgePublicationChecks({
          headSha,
          observedHeadSha: String(value.headRefOid ?? ""),
          rollup: value.statusCheckRollup,
        });
      }),
    merge: ({ number, headSha }) =>
      guarded("merge", async () => {
        await run(["pr", "merge", String(number), "--merge", "--match-head-commit", headSha]);
      }),
  };
}
