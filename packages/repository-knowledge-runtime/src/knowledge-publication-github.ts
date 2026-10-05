import { execFile } from "node:child_process";

import type {
  KnowledgePublicationChecks,
  KnowledgePublicationForge,
  KnowledgePublicationPullRequest,
} from "./knowledge-publication-forge.js";

const PASSING = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
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
        (error, stdout) => (error === null ? resolveRun(stdout) : reject(error)),
      );
      if (input !== undefined) child.stdin?.end(input);
    });
}

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
    throw new Error("The GitHub pull request response is invalid.");
  return {
    number: item.number as number,
    url: item.url,
    state,
    headSha: item.headRefOid,
    title: typeof item.title === "string" ? item.title : "",
    body: typeof item.body === "string" ? item.body : "",
  };
}

/** Reduces a status rollup for one exact head; a moved head is still pending. */
export function summarizeKnowledgePublicationChecks(input: {
  headSha: string;
  observedHeadSha: string;
  rollup: unknown;
}): KnowledgePublicationChecks {
  const items = Array.isArray(input.rollup) ? (input.rollup as Record<string, unknown>[]) : [];
  if (input.observedHeadSha !== input.headSha || items.length === 0)
    return { state: "pending", total: items.length };
  let failed = 0;
  for (const item of items) {
    const conclusion =
      item.__typename === "StatusContext"
        ? String(item.state ?? "")
        : String(item.status ?? "") === "COMPLETED"
          ? String(item.conclusion ?? "")
          : "";
    if (conclusion === "" || conclusion === "PENDING" || conclusion === "EXPECTED")
      return { state: "pending", total: items.length };
    if (!PASSING.has(conclusion)) failed++;
  }
  return failed === 0
    ? { state: "passed", total: items.length }
    : { state: "failed", total: items.length, failed };
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
    async findPullRequest({ head, base }) {
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
      if (!Array.isArray(list)) throw new Error("The GitHub pull request list is invalid.");
      return list.length === 0 ? null : pullRequest(list[0]);
    },
    async createPullRequest({ head, base, title, body }) {
      const url = (
        await run(
          ["pr", "create", "--head", head, "--base", base, "--title", title, "--body-file", "-"],
          body,
        )
      ).trim();
      const number = Number(/\/pull\/(\d+)$/u.exec(url)?.[1]);
      if (!Number.isSafeInteger(number)) throw new Error("The created pull request is unknown.");
      return view(number);
    },
    async updatePullRequest({ number, title, body }) {
      await run(["pr", "edit", String(number), "--title", title, "--body-file", "-"], body);
    },
    viewPullRequest: view,
    async closePullRequest({ number, comment }) {
      await run(["pr", "close", String(number), "--comment", comment]);
    },
    async checks({ number, headSha }) {
      const value = JSON.parse(
        await run(["pr", "view", String(number), "--json", "headRefOid,statusCheckRollup"]),
      ) as { headRefOid?: unknown; statusCheckRollup?: unknown };
      return summarizeKnowledgePublicationChecks({
        headSha,
        observedHeadSha: String(value.headRefOid ?? ""),
        rollup: value.statusCheckRollup,
      });
    },
    async merge({ number, headSha }) {
      await run(["pr", "merge", String(number), "--merge", "--match-head-commit", headSha]);
    },
  };
}
