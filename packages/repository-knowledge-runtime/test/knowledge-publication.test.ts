import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { writeConvergenceOwnerFence } from "../src/convergence-owner-fence.js";
import { CONVERGENCE_OWNER_HOST_PATH } from "../src/convergence-owner-host.js";
import { renderKnowledgePublicationBody } from "../src/knowledge-publication-body.js";
import type {
  KnowledgePublicationChecks,
  KnowledgePublicationForge,
  KnowledgePublicationPullRequest,
} from "../src/knowledge-publication-forge.js";
import {
  createGitHubKnowledgePublicationForge,
  summarizeKnowledgePublicationChecks,
} from "../src/knowledge-publication-github.js";
import { publishKnowledgeOutputs } from "../src/knowledge-publication.js";
import { readKnowledgePublicationState } from "../src/knowledge-publication-state.js";

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const developer = {
  GIT_AUTHOR_NAME: "Developer",
  GIT_AUTHOR_EMAIL: "dev@example.com",
  GIT_COMMITTER_NAME: "Developer",
  GIT_COMMITTER_EMAIL: "dev@example.com",
};
const knowledge = {
  GIT_AUTHOR_NAME: "Lervo Knowledge",
  GIT_AUTHOR_EMAIL: "knowledge@lervo.invalid",
  GIT_COMMITTER_NAME: "Lervo Knowledge",
  GIT_COMMITTER_EMAIL: "knowledge@lervo.invalid",
};

async function git(root: string, args: string[], env: NodeJS.ProcessEnv = developer) {
  const { stdout } = await execute("git", ["-C", root, ...args], {
    env: { ...process.env, ...env },
  });
  return stdout.trim();
}

async function commit(
  root: string,
  path: string,
  content: string,
  identity: NodeJS.ProcessEnv,
  message = "docs: apply reviewed background knowledge",
) {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(resolve(root, path), content);
  await git(root, ["add", "--", path], identity);
  await git(
    root,
    [
      "commit",
      "--quiet",
      "-m",
      message,
      "-m",
      "Lervo convergence kco_fixture settled these reviewed outputs.",
    ],
    identity,
  );
}

/** A GitHub stand-in: pull requests in memory, merges as real merge commits on the bare remote. */
class FakeForge implements KnowledgePublicationForge {
  pullRequests: (KnowledgePublicationPullRequest & { head: string; base: string })[] = [];
  checkState: KnowledgePublicationChecks["state"] = "pending";
  merges = 0;

  constructor(
    private readonly remote: string,
    private readonly scratch: string,
  ) {}

  private async head(branch: string) {
    return (await git(this.remote, ["rev-parse", `refs/heads/${branch}`])).trim();
  }

  async findPullRequest({ head, base }: { head: string; base: string }) {
    const found = this.pullRequests.find(
      (pr) => pr.head === head && pr.base === base && pr.state === "open",
    );
    return found === undefined ? null : { ...found, headSha: await this.head(head) };
  }
  async createPullRequest(input: { head: string; base: string; title: string; body: string }) {
    const number = this.pullRequests.length + 1;
    const created = {
      ...input,
      number,
      url: `https://github.invalid/pull/${number}`,
      state: "open" as const,
      headSha: await this.head(input.head),
    };
    this.pullRequests.push(created);
    return created;
  }
  async updatePullRequest(input: { number: number; title: string; body: string }) {
    const found = this.pullRequests.find((pr) => pr.number === input.number)!;
    found.title = input.title;
    found.body = input.body;
  }
  async viewPullRequest(number: number) {
    return this.pullRequests.find((pr) => pr.number === number)!;
  }
  async checks({
    number,
    headSha,
  }: {
    number: number;
    headSha: string;
  }): Promise<KnowledgePublicationChecks> {
    const found = this.pullRequests.find((pr) => pr.number === number)!;
    if ((await this.head(found.head)) !== headSha) return { state: "pending", total: 1 };
    return this.checkState === "failed"
      ? { state: "failed", total: 2, failed: 1 }
      : { state: this.checkState, total: 2 };
  }
  async merge({ number, headSha }: { number: number; headSha: string }) {
    const found = this.pullRequests.find((pr) => pr.number === number)!;
    expect(await this.head(found.head)).toBe(headSha);
    const clone = resolve(this.scratch, `merge-${number}`);
    await execute("git", ["clone", "--quiet", this.remote, clone]);
    await git(clone, [
      "merge",
      "--no-ff",
      "--quiet",
      "-m",
      `Merge pull request #${number}`,
      `origin/${found.head}`,
    ]);
    await git(clone, ["push", "--quiet", "origin", `HEAD:refs/heads/${found.base}`]);
    found.state = "merged";
    this.merges++;
  }
}

async function setup(options: { merge?: "when_checks_pass" | "never" } = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-publication-"));
  directories.push(directory);
  const remote = resolve(directory, "remote.git");
  await execute("git", ["init", "--quiet", "--bare", "-b", "main", remote]);
  const seed = resolve(directory, "seed");
  await execute("git", ["clone", "--quiet", remote, seed]);
  await git(seed, ["checkout", "--quiet", "-b", "main"]);
  await writeFile(resolve(seed, ".gitignore"), ".lervo/state/\n");
  await git(seed, ["add", ".gitignore"]);
  await commit(seed, "docs/runtime.md", "# Runtime\n", developer, "docs: seed");
  await git(seed, ["push", "--quiet", "origin", "main"]);
  const root = resolve(directory, "owner");
  await execute("git", ["clone", "--quiet", remote, root]);
  await mkdir(resolve(root, ".lervo/state/knowledge"), { recursive: true });
  await writeFile(
    resolve(root, CONVERGENCE_OWNER_HOST_PATH),
    JSON.stringify({
      schemaVersion: 1,
      hostId: `hst_${"1".repeat(32)}`,
      hostLabel: "mac",
      coordination: { mode: "standalone" },
      publication: {
        remote: "origin",
        baseBranch: "main",
        branch: "lervo/knowledge-outputs",
        merge: options.merge ?? "when_checks_pass",
      },
    }),
  );
  const owner = async (role: "owner" | "waiting_owner") =>
    writeConvergenceOwnerFence(root, {
      schemaVersion: 1,
      recordedHolderKey: null,
      verdict: {
        role,
        reason: role === "owner" ? "standalone_owner" : "convergence_owner_elsewhere",
        mode: "standalone",
        hostHash: `sha256:${"1".repeat(64)}`,
        hostLabel: "mac",
        holder: null,
        validUntil: role === "owner" ? new Date(Date.now() + 3_600_000).toISOString() : null,
        wakeAt: null,
        grantedAt: null,
        yieldUntil: null,
        observedAt: new Date().toISOString(),
      },
    });
  await owner("owner");
  const forge = new FakeForge(remote, directory);
  const publish = () => publishKnowledgeOutputs({ repositoryRoot: root, forge });
  return { root, remote, forge, publish, owner };
}

const remoteMain = (remote: string) => git(remote, ["rev-parse", "refs/heads/main"]);

describe("knowledge output publication", () => {
  it(
    "publishes owner commits as one pull request, merges after checks pass, and fast-forwards local main",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      await commit(root, "docs/runtime.md", "# Runtime\n\nOne.\n", knowledge);
      await commit(
        root,
        ".lervo/knowledge/document-normalizations/aa/record.yaml",
        "a: 1\n",
        knowledge,
      );
      const head = await git(root, ["rev-parse", "HEAD"]);

      const pending = await publish();
      expect(pending).toMatchObject({
        status: "published",
        state: {
          status: "awaiting_checks",
          pullRequestNumber: 1,
          commitCount: 2,
          publishedHead: head,
        },
        retryAfterMs: 120_000,
      });
      expect(await git(remote, ["rev-parse", "refs/heads/lervo/knowledge-outputs"])).toBe(head);
      expect(forge.pullRequests[0]).toMatchObject({
        title: "docs: publish reviewed background knowledge",
        base: "main",
        head: "lervo/knowledge-outputs",
      });
      expect(forge.merges).toBe(0);

      forge.checkState = "passed";
      expect(await publish()).toMatchObject({ state: { status: "merged" } });
      expect(forge.merges).toBe(1);
      // The merge commit has the local commits as its second parent, so local main fast-forwards.
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(await remoteMain(remote));
      expect(await git(root, ["status", "--porcelain"])).toBe("");
      expect(await publish()).toEqual({ status: "unchanged" });
    },
  );

  it(
    "replays only knowledge commits when local main also holds developer work",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      await commit(
        root,
        "src/feature.ts",
        "export const value = 1;\n",
        developer,
        "feat: add value",
      );
      await commit(root, "docs/runtime.md", "# Runtime\n\nOwner.\n", knowledge);
      forge.checkState = "passed";
      expect(await publish()).toMatchObject({
        state: { status: "local_diverged", commitCount: 1 },
      });
      const published = await git(remote, [
        "log",
        "--format=%an %s",
        "refs/heads/lervo/knowledge-outputs",
      ]);
      expect(published).not.toContain("Developer feat: add value");
      expect(await git(remote, ["show", "refs/heads/main:docs/runtime.md"])).toContain("Owner.");
      await expect(git(remote, ["show", "refs/heads/main:src/feature.ts"])).rejects.toThrow();
      // The developer commit stays local and unpublished; main is left for its owner to pull.
      expect(await git(root, ["log", "-1", "--format=%s"])).toBe(
        "docs: apply reviewed background knowledge",
      );
      expect(forge.pullRequests[0]!.body).toContain("replayed onto `origin/main`");
    },
  );

  it(
    "resets an equivalent local main after a replayed merge without losing work",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      // Another merge lands first, so the owner's commit must be replayed onto the new base.
      const other = resolve(root, "..", "other");
      await execute("git", ["clone", "--quiet", remote, other]);
      await commit(other, "README.md", "# Other\n", developer, "docs: other");
      await git(other, ["push", "--quiet", "origin", "main"]);
      await commit(root, "docs/runtime.md", "# Runtime\n\nOwner.\n", knowledge);
      forge.checkState = "passed";
      await writeFile(resolve(root, "notes.txt"), "uncommitted\n");
      expect(await publish()).toMatchObject({ state: { status: "merged" } });
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(await remoteMain(remote));
      expect(await readFile(resolve(root, "notes.txt"), "utf8")).toBe("uncommitted\n");
    },
  );

  it("refuses a knowledge commit outside the allowed roots and records one failure", async () => {
    const { root, remote, forge, publish } = await setup();
    await commit(root, "src/generated.ts", "export {};\n", knowledge);
    const first = await publish();
    const second = await publish();
    expect(first).toMatchObject({
      state: {
        status: "failed",
        failure: { code: "knowledge_publication_scope_violation", occurrences: 1 },
      },
    });
    expect(second).toMatchObject({ state: { failure: { occurrences: 2 } } });
    expect(forge.pullRequests).toEqual([]);
    await expect(
      git(remote, ["rev-parse", "refs/heads/lervo/knowledge-outputs"]),
    ).rejects.toThrow();
  });

  it(
    "stops at the pull request when checks fail or merging is disabled",
    { timeout: 60_000 },
    async () => {
      const failing = await setup();
      await commit(failing.root, "docs/runtime.md", "# Runtime\n\nA.\n", knowledge);
      failing.forge.checkState = "failed";
      expect(await failing.publish()).toMatchObject({
        state: {
          status: "failed",
          pullRequestNumber: 1,
          failure: { code: "knowledge_publication_checks_failed", detail: "1 of 2 checks failed" },
        },
      });
      expect(failing.forge.merges).toBe(0);

      const manual = await setup({ merge: "never" });
      await commit(manual.root, "docs/runtime.md", "# Runtime\n\nB.\n", knowledge);
      manual.forge.checkState = "passed";
      expect(await manual.publish()).toMatchObject({ state: { status: "open" } });
      expect(manual.forge.merges).toBe(0);
      expect(manual.forge.pullRequests[0]!.body).toContain("The publisher does not merge.");
    },
  );

  it("does nothing on a non-owner and reports a push failure as attention", async () => {
    const { root, remote, publish, owner } = await setup();
    await commit(root, "docs/runtime.md", "# Runtime\n\nC.\n", knowledge);
    await owner("waiting_owner");
    expect(await publish()).toEqual({ status: "not_owner" });
    await owner("owner");
    await rm(remote, { recursive: true, force: true });
    expect(await publish()).toMatchObject({
      state: { status: "failed", failure: { code: "knowledge_publication_fetch_failed" } },
    });
    expect(await readKnowledgePublicationState(root)).toMatchObject({ status: "failed" });
  });
});

describe("knowledge publication pull request body", () => {
  it("follows every template section in order, starts at H2, and checks only verified items", async () => {
    const template = await readFile(
      resolve(import.meta.dirname, "../../../.github/PULL_REQUEST_TEMPLATE.md"),
      "utf8",
    );
    const headings = template.split("\n").filter((line) => line.startsWith("## "));
    const body = renderKnowledgePublicationBody({
      commits: [
        {
          sha: "a".repeat(40),
          subject: "docs: apply reviewed background knowledge",
          body: "Lervo convergence kco_1 settled these reviewed outputs.",
          paths: ["docs/a.md"],
        },
      ],
      settings: {
        remote: "origin",
        baseBranch: "main",
        branch: "lervo/knowledge-outputs",
        merge: "when_checks_pass",
        allowedRoots: ["docs/", ".lervo/knowledge/"],
      },
      host: { hostHash: `sha256:${"1".repeat(64)}`, hostLabel: "wsl" },
      rebuilt: false,
    });
    expect(body.split("\n").filter((line) => line.startsWith("## "))).toEqual(headings);
    expect(body).not.toMatch(/^# /mu);
    expect(body).not.toContain("<!--");
    const items = template.split("\n").filter((line) => line.startsWith("- [ ] "));
    const rendered = body.split("\n").filter((line) => /^- \[[ x]\] /u.test(line));
    expect(rendered.map((line) => line.slice(6))).toEqual(items.map((line) => line.slice(6)));
    expect(rendered.filter((line) => line.startsWith("- [x]"))).toHaveLength(2);
    expect(body).toContain("convergence obligation `kco_1`");
  });

  it("treats a moved head or an unfinished check as pending", () => {
    const success = { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" };
    expect(
      summarizeKnowledgePublicationChecks({
        headSha: "a",
        observedHeadSha: "b",
        rollup: [success],
      }),
    ).toMatchObject({ state: "pending" });
    expect(
      summarizeKnowledgePublicationChecks({ headSha: "a", observedHeadSha: "a", rollup: [] }),
    ).toMatchObject({ state: "pending" });
    expect(
      summarizeKnowledgePublicationChecks({
        headSha: "a",
        observedHeadSha: "a",
        rollup: [success, { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" }],
      }),
    ).toMatchObject({ state: "pending" });
    expect(
      summarizeKnowledgePublicationChecks({
        headSha: "a",
        observedHeadSha: "a",
        rollup: [success, { __typename: "StatusContext", state: "FAILURE" }],
      }),
    ).toEqual({ state: "failed", total: 2, failed: 1 });
    expect(
      summarizeKnowledgePublicationChecks({
        headSha: "a",
        observedHeadSha: "a",
        rollup: [success],
      }),
    ).toEqual({ state: "passed", total: 1 });
  });
});

describe("GitHub CLI publication adapter", () => {
  it("passes bodies on stdin, reads the created number, and merges only the exact head", async () => {
    const calls: { args: string[]; input?: string }[] = [];
    const view = {
      number: 12,
      url: "https://example.invalid/pull/12",
      state: "OPEN",
      headRefOid: "b".repeat(40),
      title: "docs: publish reviewed background knowledge",
      body: "## Summary",
    };
    const forge = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      run: async (args, input) => {
        calls.push({ args, ...(input === undefined ? {} : { input }) });
        if (args[1] === "create") return "https://example.invalid/pull/12\n";
        if (args[1] === "list") return "[]";
        return JSON.stringify(view);
      },
    });
    expect(
      await forge.findPullRequest({ head: "lervo/knowledge-outputs", base: "main" }),
    ).toBeNull();
    expect(
      await forge.createPullRequest({
        head: "lervo/knowledge-outputs",
        base: "main",
        title: "t",
        body: "b",
      }),
    ).toMatchObject({ number: 12, state: "open", headSha: "b".repeat(40) });
    await forge.merge({ number: 12, headSha: "b".repeat(40) });
    expect(calls.find((call) => call.args[1] === "create")).toMatchObject({ input: "b" });
    expect(calls.at(-1)!.args).toEqual([
      "pr",
      "merge",
      "12",
      "--merge",
      "--match-head-commit",
      "b".repeat(40),
    ]);
  });
});
