import { describe, expect, it } from "vitest";

import { KnowledgePublicationForgeError } from "../src/knowledge-publication-forge.js";
import { failureDetail, transientCause } from "../src/knowledge-publication-failure.js";
import { sameBytes, KnowledgePublicationGitError } from "../src/knowledge-publication-git.js";
import {
  createGitHubKnowledgePublicationForge,
  mergeGate,
  summarizeKnowledgePublicationChecks,
} from "../src/knowledge-publication-github.js";
import {
  planKnowledgePublication,
  reduceKnowledgePublicationPolicy,
} from "../src/knowledge-publication-policy.js";
import {
  parseKnowledgePublicationRecord,
  readKnowledgePublicationHistoryCache,
} from "../src/knowledge-publication-history.js";
import { readKnowledgePublicationState } from "../src/knowledge-publication-state.js";
import { readKnowledgeSupersessionLedger } from "../src/knowledge-supersession-ledger.js";
import {
  advanceRemoteMain,
  commit,
  git,
  developer,
  knowledge,
  remoteMain,
  setup,
} from "./knowledge-publication-fixture.js";

const settings = {
  merge: "when_checks_pass" as const,
  branch: "lervo/knowledge-outputs",
  baseBranch: "main",
};
const open = { allowMergeCommit: true, allowSquashMerge: true, allowRebaseMerge: true };

describe("publication policy from the repository (ADR-0603)", () => {
  it("allows only what the settings and every rule allow, and prefers a merge commit", () => {
    const plan = (input: Partial<Parameters<typeof reduceKnowledgePublicationPolicy>[0]>) =>
      planKnowledgePublication(
        reduceKnowledgePublicationPolicy({
          repository: open,
          baseRules: [],
          branchRules: [],
          protection: null,
          branchProtection: null,
          ...input,
        }),
        settings,
      );
    expect(plan({})).toMatchObject({ status: "ready", merge: "merge" });
    // flemo: a ruleset that allows only squash.
    expect(
      plan({
        baseRules: [{ type: "pull_request", parameters: { allowed_merge_methods: ["squash"] } }],
      }),
    ).toMatchObject({ status: "ready", merge: "squash" });
    expect(plan({ baseRules: [{ type: "required_linear_history" }] })).toMatchObject({
      merge: "squash",
    });
    // Signed commits leave only the forge's own signed squash.
    expect(plan({ baseRules: [{ type: "required_signatures" }] })).toMatchObject({
      merge: "squash",
    });
    expect(
      plan({
        repository: { allowMergeCommit: false, allowSquashMerge: false, allowRebaseMerge: true },
        protection: {
          requiredChecks: [],
          strict: false,
          linearHistory: true,
          signatures: true,
          reviewRequired: false,
        },
      }),
    ).toEqual({
      status: "refused",
      detail:
        "base main: no allowed merge method (merge by repository settings, squash by repository settings, rebase by required_signatures)",
    });
    // A rule Lervo does not know, or cannot meet, refuses by name; so do rules it could not read.
    expect(
      plan({
        baseRules: [
          { type: "required_deployments" },
          { type: "code_scanning" },
          { type: "workflows" },
          { type: "commit_message_pattern" },
        ],
      }),
    ).toEqual({
      status: "refused",
      detail: "base main: code_scanning, commit_message_pattern, required_deployments, workflows",
    });
    // A merge updates the base, so a rule that lets only bypass actors update it refuses.
    expect(plan({ baseRules: [{ type: "update" }] })).toEqual({
      status: "refused",
      detail: "base main: update (only bypass actors may update the base, including by a merge)",
    });
    // A merge queue is entered, and merges with its own method.
    expect(plan({ baseRules: [{ type: "merge_queue" }] })).toMatchObject({
      status: "ready",
      merge: "queue",
    });
    // Classic protection whose details the host may not read is unknown, never none.
    expect(plan({ protection: { unreadable: "auth" } })).toEqual({
      status: "refused",
      detail: "base main: protection unreadable (auth)",
    });
    expect(plan({ branchProtection: { unreadable: "auth" } })).toEqual({
      status: "refused",
      detail: "branch lervo/knowledge-outputs: protection unreadable (auth)",
    });
    expect(plan({ baseRules: { unreadable: "not_found" } })).toEqual({
      status: "refused",
      detail: "base main: rules unreadable (not_found)",
    });
    // A setting the forge did not report is unknown, never allowed.
    expect(
      plan({
        repository: { allowMergeCommit: null, allowSquashMerge: null, allowRebaseMerge: null },
      }),
    ).toEqual({
      status: "refused",
      detail:
        "base main: no allowed merge method (merge by repository settings (unknown), squash by repository settings (unknown), rebase by repository settings (unknown))",
    });
    // The publication branch's own protection and rules: force pushes, creation, unsigned commits.
    expect(
      plan({
        branchRules: [{ type: "creation" }, { type: "update" }, { type: "deletion" }],
        branchProtection: { forcePushAllowed: false, signatures: true },
      }),
    ).toEqual({
      status: "refused",
      detail:
        "branch lervo/knowledge-outputs: creation, protection: force pushes, protection: required_signatures, update",
    });
    // Lervo rebuilds its branch on each new base, with unsigned commits.
    expect(
      plan({ branchRules: [{ type: "non_fast_forward" }, { type: "required_signatures" }] }),
    ).toEqual({
      status: "refused",
      detail: "branch lervo/knowledge-outputs: non_fast_forward, required_signatures",
    });
    expect(
      plan({
        baseRules: [
          {
            type: "required_status_checks",
            parameters: {
              strict_required_status_checks_policy: true,
              required_status_checks: [{ context: "Verify" }, { context: "E2E" }],
            },
          },
          { type: "pull_request", parameters: { required_approving_review_count: 1 } },
        ],
      }),
    ).toMatchObject({
      status: "ready",
      requiredChecks: ["E2E", "Verify"],
      strict: true,
      reviewRequired: true,
    });
  });

  it("reads settings, rules for both branches and protection, treating absence as none", async () => {
    const calls: string[][] = [];
    const forge = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      run: async (args) => {
        calls.push(args);
        const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
        if (path === "repos/{owner}/{repo}")
          return JSON.stringify({
            allowMergeCommit: true,
            allowSquashMerge: true,
            allowRebaseMerge: false,
          });
        // gh prints each page's items one per line (`--paginate --jq '.[]'`), also before 2.48.
        if (path.endsWith("/rules/branches/main")) {
          expect(args).toEqual(["api", "--paginate", path, "--jq", ".[]"]);
          return `${JSON.stringify({ type: "deletion" })}\n${JSON.stringify({
            type: "pull_request",
            parameters: { allowed_merge_methods: ["squash"] },
          })}\n`;
        }
        if (path.endsWith("/rules/branches/lervo%2Fknowledge-outputs")) return "";
        // ADR-0603: the branch's own flag needs no admin rights; an unprotected base has none.
        if (path === "repos/{owner}/{repo}/branches/main") return "false\n";
        if (path === "repos/{owner}/{repo}/branches/lervo%2Fknowledge-outputs")
          throw Object.assign(new Error("gh"), {
            code: 1,
            stderr: "gh: Branch not found (HTTP 404)",
          });
        throw new Error(`unexpected ${args.join(" ")}`);
      },
    });
    await expect(
      forge.policy({ base: "main", branch: "lervo/knowledge-outputs" }),
    ).resolves.toEqual({
      mergeMethods: ["squash"],
      excluded: [
        { method: "rebase", rule: "repository settings" },
        { method: "merge", rule: "pull_request.allowed_merge_methods" },
      ],
      requiredChecks: [],
      strict: false,
      reviewRequired: false,
      mergeQueue: false,
      baseRefusals: [],
      branchRefusals: [],
    });
    expect(calls.map((args) => args[2])).toContain("repos/{owner}/{repo}/rules/branches/main");
    expect(calls.some((args) => args[1]?.endsWith("/protection"))).toBe(false);
    // A protected branch whose details the host may not read is unknown, never none.
    const unreadable = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      run: async (args) => {
        const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
        if (path === "repos/{owner}/{repo}") return JSON.stringify(open);
        if (path.includes("/rules/")) return "";
        if (path.endsWith("/branches/main")) return "true\n";
        if (path.endsWith("/branches/main/protection"))
          throw Object.assign(new Error("gh"), {
            code: 1,
            stderr: "gh: Must have admin rights to Repository. (HTTP 403)",
          });
        return "false\n";
      },
    });
    await expect(unreadable.policy({ base: "main", branch: "b" })).resolves.toMatchObject({
      baseRefusals: ["protection unreadable (auth)"],
      branchRefusals: [],
    });
    // A private repository on a free plan has no rulesets or protection at all: GitHub answers
    // 403 with this message (observed on kimjh96/lervo), which means none, not unreadable.
    const free = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      run: async (args) => {
        const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
        if (path === "repos/{owner}/{repo}") return JSON.stringify(open);
        if (path === "repos/{owner}/{repo}/branches/main") return "true\n";
        if (path === "repos/{owner}/{repo}/branches/b") return "false\n";
        throw Object.assign(new Error("gh"), {
          code: 1,
          stderr:
            "gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)",
        });
      },
    });
    await expect(free.policy({ base: "main", branch: "b" })).resolves.toMatchObject({
      mergeMethods: ["merge", "squash", "rebase"],
      baseRefusals: [],
      branchRefusals: [],
    });
    // A rate limit answers 403 too, and clears on its own.
    const limited = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      run: async () => {
        throw Object.assign(new Error("gh"), {
          code: 1,
          stderr: "gh: API rate limit exceeded for user ID 1. (HTTP 403)",
        });
      },
    });
    const refusal = await limited.policy({ base: "main", branch: "b" }).catch((error) => error);
    expect(refusal).toMatchObject({ failureClass: "rate_limited" });
    expect(transientCause(refusal)).toBe(true);
    // Rules the host may not read are unknown, never none.
    const hidden = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      run: async (args) => {
        const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
        if (path === "repos/{owner}/{repo}")
          return JSON.stringify({ allowMergeCommit: true, allowSquashMerge: true });
        if (path.includes("/rules/"))
          throw Object.assign(new Error("gh"), { code: 1, stderr: "HTTP 404: Not Found" });
        if (!path.endsWith("/protection")) return "true\n";
        throw Object.assign(new Error("gh"), { code: 1, stderr: "HTTP 404: Branch not protected" });
      },
    });
    await expect(hidden.policy({ base: "main", branch: "b" })).resolves.toMatchObject({
      excluded: [{ method: "rebase", rule: "repository settings (unknown)" }],
      baseRefusals: ["rules unreadable (not_found)"],
      branchRefusals: ["rules unreadable (not_found)"],
    });
    // Any other failure is a failure of the read.
    const failing = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      run: async () => {
        throw Object.assign(new Error("gh"), { code: 1, stderr: "HTTP 502: Bad Gateway" });
      },
    });
    await expect(failing.policy({ base: "main", branch: "b" })).rejects.toMatchObject({
      operation: "policy",
      failureClass: "network",
    });
    expect(mergeGate("BEHIND", null)).toBe("behind");
    expect(mergeGate("BLOCKED", "REVIEW_REQUIRED")).toBe("review_required");
    expect(mergeGate("BLOCKED", "APPROVED")).toBe("blocked");
    expect(mergeGate("UNSTABLE", null)).toBe("ready");
    expect(mergeGate("DIRTY", null)).toBe("conflict");
    // ADR-0603: a draft waits for a person; a merge queue, including a classic one no rule
    // reports, is entered instead of merged.
    expect(mergeGate("DRAFT", null)).toBe("draft");
    expect(mergeGate("CLEAN", null, { isDraft: true })).toBe("draft");
    expect(mergeGate("CLEAN", null, { isMergeQueueEnabled: true })).toBe("queue");
    expect(mergeGate("BLOCKED", null, { isMergeQueueEnabled: true, isInMergeQueue: true })).toBe(
      "queued",
    );
  });
});

describe("publication judged by content, whatever the merge method (ADR-0603)", () => {
  it(
    "merges a squash-only repository with a squash and syncs the local base without a conflict",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      forge.policyValue = { ...forge.policyValue, mergeMethods: ["squash"] };
      forge.checkState = "passed";
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      await commit(root, "docs/runtime.md", "# Runtime\n\nSecond.\n", knowledge);
      const first = await publish();
      expect(forge.mergeMethods).toEqual(["squash"]);
      expect(first).toMatchObject({ state: { status: "merged", failure: null } });
      // The squash leaves no ancestry or patch behind, yet the local base resets to it.
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(await remoteMain(remote));
      // A later commit publishes alone; nothing is superseded.
      await commit(root, "docs/runtime.md", "# Runtime\n\nThird.\n", knowledge);
      await expect(publish()).resolves.toMatchObject({
        state: { status: "merged", commitCount: 1, failure: null },
      });
      expect(forge.mergeMethods).toEqual(["squash", "squash"]);
      expect((await readKnowledgeSupersessionLedger(root))?.entries ?? []).toEqual([]);
    },
  );

  it(
    "never supersedes knowledge commits a person squash-merged (the 2026-11-02 flemo rollback)",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup({ merge: "never" });
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      await commit(root, "docs/runtime.md", "# Runtime\n\nSecond.\n", knowledge);
      await expect(publish()).resolves.toMatchObject({ state: { status: "open" } });
      // A person squash-merges the pull request on the forge.
      const opened = forge.pullRequests[0]!;
      await forge.merge({ number: opened.number, headSha: opened.headSha, method: "squash" });
      // Replaying the first commit onto the squashed base conflicts; its content is already there.
      const after = await publish();
      expect(after).toMatchObject({ state: { failure: null } });
      expect(after).not.toMatchObject({ state: { status: "superseded" } });
      expect((await readKnowledgeSupersessionLedger(root))?.entries ?? []).toEqual([]);
      expect(forge.closed).toEqual([]);
    },
  );

  it(
    "keeps a squashed publication published after the base changes its paths again",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      forge.policyValue = { ...forge.policyValue, mergeMethods: ["squash"] };
      forge.checkState = "passed";
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      await commit(root, "docs/runtime.md", "# Runtime\n\nSecond.\n", knowledge);
      // Unpublished developer work keeps the local base from resetting to the squash.
      await commit(root, "src/app.ts", "export {};\n", developer, "feat: local work");
      await expect(publish()).resolves.toMatchObject({ state: { status: "local_diverged" } });
      expect(forge.pullRequests).toHaveLength(1);
      // A developer then changes the published path on the base: the bytes no longer tell.
      await advanceRemoteMain(remote, "docs/runtime.md", "# Runtime\n\nA person's edit.\n");
      await git(root, ["fetch", "--quiet", "origin"]);
      const after = await publish();
      expect(after).not.toMatchObject({ state: { status: "superseded" } });
      expect(forge.pullRequests).toHaveLength(1);
      expect((await readKnowledgeSupersessionLedger(root))?.entries ?? []).toEqual([]);
    },
  );
});

describe("what stands before a merge (ADR-0603)", () => {
  it(
    "rebuilds a head the base moved past, backs off a person's review per head, and merges once ready",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup();
      forge.checkState = "passed";
      forge.policyValue = { ...forge.policyValue, requiredChecks: ["E2E", "Verify"], strict: true };
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      forge.gateValue = "behind";
      await expect(publish()).resolves.toMatchObject({ state: { status: "awaiting_checks" } });
      expect(forge.checkCalls.at(-1)?.required).toEqual(["E2E", "Verify"]);
      forge.gateValue = "review_required";
      // ADR-0602: a person's review is read again after 15 minutes and 1 hour, then no timer is
      // armed; the next cycle that runs for another reason reads it again. No 6-hour repeat. The
      // look at the `behind` gate counts too: one wait per pull request and commits.
      for (const [attempts, wait] of [
        [2, 60 * 60_000],
        [3, null],
        [4, null],
      ] as const)
        await expect(publish()).resolves.toMatchObject({
          state: { status: "open", failure: null, wait: { kind: "review", attempts } },
          retryAfterMs: wait,
        });
      // A new head starts the wait over.
      await commit(root, "docs/runtime.md", "# Runtime\n\nSecond.\n", knowledge);
      await expect(publish()).resolves.toMatchObject({
        state: { wait: { kind: "review", attempts: 1 } },
        retryAfterMs: 15 * 60_000,
      });
      expect(forge.merges).toBe(0);
      forge.gateValue = "ready";
      const merged = await publish();
      expect(merged).toMatchObject({ state: { status: "merged" } });
      expect(merged).not.toHaveProperty("state.wait");
    },
  );

  it(
    "never counts a merge the forge does not report, and waits on a merge it blocks",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup();
      forge.checkState = "passed";
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      // `gh pr merge` succeeded, as into a merge queue, but the pull request is still open.
      forge.mergeLands = false;
      const unmerged = await publish();
      expect(unmerged).toMatchObject({
        state: {
          status: "failed",
          failure: {
            code: "knowledge_publication_merge_failed",
            detail: "the merge command succeeded but the pull request is open",
          },
        },
        retryAfterMs: 2 * 60_000,
      });
      // The commits were not published: the next cycle publishes them again.
      expect(forge.merges).toBe(0);
      forge.gateValue = "blocked";
      await expect(publish()).resolves.toMatchObject({
        state: {
          status: "awaiting_checks",
          failure: null,
          wait: { kind: "gate", reason: "blocked" },
        },
        retryAfterMs: 2 * 60_000,
      });
    },
  );

  it(
    "refuses before pushing when the policy has a requirement Lervo cannot meet",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      forge.policyValue = {
        ...forge.policyValue,
        mergeMethods: [],
        excluded: [{ method: "merge", rule: "repository settings" }],
      };
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      const refused = await publish();
      expect(refused).toMatchObject({
        state: {
          status: "failed",
          failure: {
            code: "knowledge_publication_policy_refused",
            detail: "base main: no allowed merge method (merge by repository settings)",
          },
        },
        retryAfterMs: null,
      });
      // Nothing was pushed and no pull request opened.
      await expect(
        git(remote, ["rev-parse", "refs/heads/lervo/knowledge-outputs"]),
      ).rejects.toThrow();
      expect(forge.pullRequests).toEqual([]);
    },
  );

  it(
    "retries a transient merge failure at a backoff deadline and waits out a refused method",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup();
      forge.checkState = "passed";
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      forge.mergeError = new KnowledgePublicationForgeError("merge", 1, "unknown", {
        reason: "GraphQL: Something went wrong",
      });
      const first = await publish();
      expect(first).toMatchObject({
        state: {
          status: "failed",
          failure: {
            code: "knowledge_publication_merge_failed",
            detail: "gh merge exit 1 unknown: GraphQL: Something went wrong",
          },
        },
        retryAfterMs: 2 * 60_000,
      });
      await expect(publish()).resolves.toMatchObject({ retryAfterMs: 4 * 60_000 });
      forge.mergeError = new KnowledgePublicationForgeError("merge", 1, "method_not_allowed", {
        reason: "Merge commits are not allowed on this repository.",
      });
      await expect(publish()).resolves.toMatchObject({
        state: { failure: { code: "knowledge_publication_policy_refused" } },
        retryAfterMs: null,
      });
    },
  );
});

describe("a publication merged by anyone stays published (ADR-0603)", () => {
  it(
    "keeps a person's squash published after the base edits its paths, superseding nothing",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup({ merge: "never" });
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      await commit(root, "docs/runtime.md", "# Runtime\n\nSecond.\n", knowledge);
      await expect(publish()).resolves.toMatchObject({ state: { status: "open" } });
      const carried = parseKnowledgePublicationRecord(forge.pullRequests[0]!.body)!.commits;
      expect(carried).toHaveLength(2);
      // A person squash-merges it, then edits the same document on the base.
      const opened = forge.pullRequests[0]!;
      await forge.merge({ number: opened.number, headSha: opened.headSha, method: "squash" });
      await advanceRemoteMain(remote, "docs/runtime.md", "# Runtime\n\nA person's edit.\n");
      const after = await publish();
      expect(after).not.toMatchObject({ state: { status: "superseded" } });
      // ADR-0603: GitHub's merged record says both commits are published, so nothing was
      // superseded and the local base caught up; they left `base..HEAD`, and the cache with them.
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(await remoteMain(remote));
      expect((await readKnowledgePublicationHistoryCache(root))?.local?.published).toEqual([]);
      expect((await readKnowledgeSupersessionLedger(root))?.entries ?? []).toEqual([]);
      expect(forge.closed).toEqual([]);
      expect(forge.pullRequests).toHaveLength(1);
    },
  );

  it(
    "never publishes against a person's revert of a merged publication, and reports it",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      forge.checkState = "passed";
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      await expect(publish()).resolves.toMatchObject({ state: { status: "merged" } });
      // A person reverts the merged document on the base.
      await advanceRemoteMain(remote, "docs/runtime.md", "# Runtime\n");
      await git(root, ["fetch", "--quiet", "origin"]);
      const after = await publish();
      expect(forge.pullRequests).toHaveLength(1);
      expect(after).not.toMatchObject({ state: { status: "superseded" } });
      expect(await readKnowledgePublicationState(root)).toMatchObject({
        baseChanged: {
          pullRequestNumber: 1,
          paths: 1,
          mergeCommit: forge.pullRequests[0]!.mergeCommit,
        },
      });
    },
  );
});

describe("checks and pushes the policy refuses (ADR-0603)", () => {
  it("fails, by name, a required check that never reports once every other one finished", () => {
    const rollup = [
      {
        __typename: "CheckRun",
        name: "Verify",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        startedAt: "2026-11-21T00:00:00Z",
      },
    ];
    expect(
      summarizeKnowledgePublicationChecks({
        headSha: "a",
        observedHeadSha: "a",
        rollup,
        required: ["Verify", "E2E"],
      }),
    ).toEqual({
      state: "failed",
      total: 1,
      failed: 1,
      failures: [
        { name: "E2E", kind: "status", conclusion: "not_reported", runId: null, jobId: null },
      ],
    });
    // While another check still runs, it is only pending.
    expect(
      summarizeKnowledgePublicationChecks({
        headSha: "a",
        observedHeadSha: "a",
        rollup: [
          ...rollup,
          { ...rollup[0], name: "Lint", status: "IN_PROGRESS", conclusion: null },
        ],
        required: ["Verify", "E2E"],
      }),
    ).toMatchObject({ state: "pending" });
  });

  it("treats a push a ruleset refused as needing a person, not a retry", () => {
    const refused = new KnowledgePublicationGitError("push", 1, {
      cause: Object.assign(new Error("push"), {
        stderr: "remote: error: GH013: Repository rule violations found for refs/heads/lervo/x.",
      }),
    });
    expect(transientCause(refused)).toBe(false);
    expect(failureDetail(refused)).toBe("git push exit 1 rule_refusal");
    const network = new KnowledgePublicationGitError("push", 128, {
      cause: Object.assign(new Error("push"), { stderr: "fatal: unable to access: timeout" }),
    });
    expect(transientCause(network)).toBe(true);
  });
});

it("treats a Git error as an error, never as bytes that differ", { timeout: 60_000 }, async () => {
  const { root } = await setup();
  await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
  const head = await git(root, ["rev-parse", "HEAD"]);
  // A base Git cannot read: before, the catch-up read it as bytes that differ.
  await expect(
    sameBytes(root, "0".repeat(40), head, ["docs/runtime.md"], "inspect"),
  ).rejects.toBeInstanceOf(KnowledgePublicationGitError);
  await expect(sameBytes(root, head, head, ["docs/runtime.md"], "inspect")).resolves.toBe(true);
});
