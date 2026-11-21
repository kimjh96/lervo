import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { renderKnowledgePublicationBody } from "../src/knowledge-publication-body.js";
import {
  createGitHubKnowledgePublicationForge,
  summarizeKnowledgePublicationChecks,
} from "../src/knowledge-publication-github.js";
import type { KnowledgeOutputFormatter } from "../src/knowledge-output-formatter.js";
import { KnowledgePublicationForgeError } from "../src/knowledge-publication-forge.js";
import {
  markKnowledgePublicationClosed,
  parseKnowledgePublicationRecord,
  renderKnowledgePublicationRecord,
} from "../src/knowledge-publication-history.js";

/** A publication body as gh returns it, for adapter tests that close a pull request. */
const RECORDED_BODY = JSON.stringify({
  body: `## Summary\n\n${renderKnowledgePublicationRecord({ head: "c".repeat(40), commits: ["d".repeat(40)] })}\n`,
});
const viewsBody = (args: string[]) => args[0] === "pr" && args[1] === "view" && args[4] === "body";
const MARK_CLOSED = (number: number) => [
  ["pr", "view", String(number), "--json", "body"],
  ["api", "--method", "PATCH", `repos/{owner}/{repo}/pulls/${number}`, "--input", "-"],
];
import { CONVERGENCE_DELEGATION_PATH } from "../src/delegation-contract.js";
import { readKnowledgePublicationState } from "../src/knowledge-publication-state.js";
import { readKnowledgeSupersessionLedger } from "../src/knowledge-supersession-ledger.js";
import {
  advanceRemoteMain,
  commit,
  developer,
  execute,
  git,
  isAncestor,
  knowledge,
  publicationDelegation,
  remoteMain,
  setup,
} from "./knowledge-publication-fixture.js";

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
          wait: { kind: "checks", reason: "running", attempts: 1 },
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
      // ADR-0603: the body's record is what every host reads as published, so a description
      // update gh refuses blocks the merge until the record names the pushed head.
      forge.pullRequests[0]!.body = "stale description";
      forge.updateError = new KnowledgePublicationForgeError("update", 1, "unknown");
      expect(await publish()).toMatchObject({
        state: { status: "failed", failure: { code: "knowledge_publication_pull_request_failed" } },
        retryAfterMs: 2 * 60_000,
      });
      expect(forge.merges).toBe(0);
      forge.updateError = null;
      expect(await publish()).toMatchObject({ state: { status: "merged" } });
      expect(forge.merges).toBe(1);
      expect(forge.pullRequests[0]!.body).toContain(`Lervo-Publication-Head: ${head}`);
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
      expect(forge.pullRequests[0]!.body).toContain("replayed onto the current `origin/main`");
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

  it(
    "replays commits that sit on an older base onto the current remote base",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup({ merge: "never" });
      await commit(root, "docs/runtime.md", "# Runtime\n\nOwner.\n", knowledge);
      const head = await git(root, ["rev-parse", "HEAD"]);
      // The local branch holds only knowledge commits, but origin/main has moved past its base.
      await advanceRemoteMain(remote, "docs/other.md", "# Other\n");
      const outcome = await publish();
      expect(outcome).toMatchObject({ state: { status: "open", commitCount: 1 } });
      const published = await git(remote, ["rev-parse", "refs/heads/lervo/knowledge-outputs"]);
      expect(published).not.toBe(head);
      expect(await isAncestor(remote, await remoteMain(remote), published)).toBe(true);
      expect(await git(remote, ["show", `${published}:docs/runtime.md`])).toContain("Owner.");
      expect(forge.pullRequests[0]!.body).toContain("replayed onto the current `origin/main`");
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(head);
    },
  );

  it(
    "supersedes stale commits that conflict with the current base, closes their pull request, and requeues convergence",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      await commit(root, "docs/runtime.md", "# Runtime\n\nStale owner output.\n", knowledge);
      const stale = await git(root, ["rev-parse", "HEAD"]);
      expect(await publish()).toMatchObject({
        state: { status: "awaiting_checks", pullRequestNumber: 1 },
      });
      // Another host's outputs for the same document merge first.
      await advanceRemoteMain(remote, "docs/runtime.md", "# Runtime\n\nCurrent output.\n");
      await writeFile(resolve(root, "notes.txt"), "uncommitted\n");

      const outcome = await publish();
      expect(outcome).toMatchObject({
        status: "published",
        retryAfterMs: 5_000,
        state: {
          status: "superseded",
          pullRequestNumber: null,
          pullRequestUrl: null,
          publishedHead: null,
          commitCount: 1,
          supersededCommits: [],
          failure: {
            code: "knowledge_publication_superseded",
            occurrences: 1,
            detail: `1 conflicting path(s) in 1 commit(s); local base reset to the remote base and convergence requeued; backup refs/lervo/knowledge-superseded/${stale.slice(0, 12)}`,
          },
        },
      });
      expect(forge.pullRequests).toHaveLength(1);
      expect(forge.pullRequests[0]!.state).toBe("closed");
      expect(forge.closed[0]!.comment).toContain("conflict with the current base");
      expect(forge.merges).toBe(0);
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(await remoteMain(remote));
      expect(
        await git(root, ["rev-parse", `refs/lervo/knowledge-superseded/${stale.slice(0, 12)}`]),
      ).toBe(stale);
      expect(await readFile(resolve(root, "notes.txt"), "utf8")).toBe("uncommitted\n");
      // The replica carries this ledger, so other hosts drop the same commit.
      expect((await readKnowledgeSupersessionLedger(root)).entries).toEqual([
        {
          commit: stale,
          patchId: expect.stringMatching(/^[0-9a-f]{40}$/u),
          base: await remoteMain(remote),
          supersededAt: expect.any(String),
        },
      ]);
      expect(await publish()).toEqual({ status: "unchanged" });

      // Regenerated outputs on the current base publish cleanly through a new pull request.
      await commit(root, "docs/runtime.md", "# Runtime\n\nCurrent output.\n\nMore.\n", knowledge);
      expect(await publish()).toMatchObject({
        state: { status: "awaiting_checks", pullRequestNumber: 2, failure: null },
      });
    },
  );

  it(
    "keeps a conflicting stale commit local beside developer work and never selects it again",
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
      await commit(root, "docs/runtime.md", "# Runtime\n\nStale owner output.\n", knowledge);
      const head = await git(root, ["rev-parse", "HEAD"]);
      await advanceRemoteMain(remote, "docs/runtime.md", "# Runtime\n\nCurrent output.\n");

      const outcome = await publish();
      expect(outcome).toMatchObject({
        retryAfterMs: null,
        state: {
          status: "superseded",
          supersededCommits: [head],
          failure: { code: "knowledge_publication_superseded" },
        },
      });
      expect(
        (outcome as { state: { failure: { detail: string } } }).state.failure.detail,
      ).toContain("local base kept");
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(head);
      expect(forge.pullRequests).toEqual([]);
      await expect(
        git(remote, ["rev-parse", "refs/heads/lervo/knowledge-outputs"]),
      ).rejects.toThrow();
      // The next cycle's supersession drops the stale commit from the branch, which moves the
      // head the history cache was keyed to: GitHub is asked once more, then nothing changes.
      await expect(publish()).resolves.toMatchObject({ state: { status: "idle" } });
      expect(await publish()).toEqual({ status: "unchanged" });
      expect(await readKnowledgePublicationState(root)).toMatchObject({
        supersededCommits: [head],
      });
    },
  );

  it(
    "keeps a pull request a person closed without merge closed, as a decision, until it reopens (ADR-0603)",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      await commit(root, "docs/runtime.md", "# Runtime\n\nOwner.\n", knowledge);
      expect(await publish()).toMatchObject({
        state: { status: "awaiting_checks", pullRequestNumber: 1 },
      });
      // A person closes it and deletes the branch: no new pull request, no push, attention.
      await forge.closeByPerson(1);
      await git(remote, ["update-ref", "-d", "refs/heads/lervo/knowledge-outputs"]);
      const declined = await publish();
      expect(declined).toMatchObject({
        state: { status: "idle", declined: [{ pullRequestNumber: 1, commitCount: 1 }] },
        retryAfterMs: null,
      });
      expect(forge.pullRequests).toHaveLength(1);
      await expect(
        git(remote, ["rev-parse", "refs/heads/lervo/knowledge-outputs"]),
      ).rejects.toThrow();
      // Still a decision on the next cycle, which needs no GitHub read for it.
      const reads = forge.historyCalls;
      expect(await publish()).toEqual({ status: "unchanged" });
      expect(forge.historyCalls).toBe(reads);
      // A new knowledge commit publishes alone; the declined one stays out.
      await commit(root, "docs/other.md", "# Other\n", knowledge);
      const head = await git(root, ["rev-parse", "HEAD"]);
      expect(await publish()).toMatchObject({
        state: { status: "awaiting_checks", pullRequestNumber: 2, commitCount: 1 },
      });
      expect(forge.pullRequests[1]!.body).toContain(`Lervo-Publication-Commit: ${head}`);
      expect(forge.pullRequests[1]!.body).not.toContain(
        `Lervo-Publication-Commit: ${await git(root, ["rev-parse", "HEAD~1"])}`,
      );
      // Without unpublished commits, a closed or unknown pull request leaves nothing to wait for.
      forge.pullRequests[1]!.state = "closed";
      await git(root, ["reset", "--quiet", "--hard", "origin/main"]);
      expect(await publish()).toMatchObject({
        state: { status: "idle", pullRequestNumber: null, pullRequestUrl: null },
      });
      forge.pullRequests.splice(0);
      await commit(root, "docs/runtime.md", "# Runtime\n\nAgain.\n", knowledge);
      expect(await publish()).toMatchObject({ state: { status: "awaiting_checks" } });
      forge.pullRequests.splice(0);
      await git(root, ["reset", "--quiet", "--hard", "origin/main"]);
      expect(await publish()).toMatchObject({
        state: { status: "idle", pullRequestNumber: null },
      });
    },
  );

  it("refuses an out-of-scope path a developer also changed and records one failure", async () => {
    const { root, remote, forge, publish } = await setup();
    await commit(root, "src/generated.ts", "export {};\n", knowledge);
    await commit(root, "src/generated.ts", "export const value = 1;\n", developer, "feat: edit");
    const first = await publish();
    const second = await publish();
    expect(first).toMatchObject({
      state: {
        status: "failed",
        failure: {
          code: "knowledge_publication_scope_violation",
          detail:
            "1 path(s) outside the knowledge write scope, 0 tool-owned path(s); automatic repair blocked: 1 developer_change",
          occurrences: 1,
        },
      },
    });
    expect(await readFile(resolve(root, "src/generated.ts"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(second).toMatchObject({ state: { failure: { occurrences: 2 } } });
    expect(forge.pullRequests).toEqual([]);
    await expect(
      git(remote, ["rev-parse", "refs/heads/lervo/knowledge-outputs"]),
    ).rejects.toThrow();
  });

  it(
    "restores an out-of-scope knowledge change in one corrective commit, records it, and publishes",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish, events } = await setup();
      await commit(root, "src/generated.ts", "export {};\n", knowledge);
      const offending = await git(root, ["rev-parse", "HEAD"]);
      expect(await publish()).toMatchObject({
        state: { status: "awaiting_checks", failure: null, commitCount: 2 },
      });
      await expect(readFile(resolve(root, "src/generated.ts"), "utf8")).rejects.toThrow();
      const repair = await git(root, ["log", "-1", "--format=%H%n%ae%n%ce%n%B"]);
      const [repairCommit, author, committer, ...message] = repair.split("\n");
      expect([author, committer]).toEqual(["knowledge@lervo.invalid", "knowledge@lervo.invalid"]);
      expect(message.join("\n")).toContain(
        "docs: restore paths the knowledge lifecycle must not change",
      );
      expect(message.join("\n")).toContain("- src/generated.ts: outside the knowledge write scope");
      expect(message.join("\n")).toContain(`Lervo-Publication-Repair: ${offending}`);
      expect(message.every((line) => line.length <= 100)).toBe(true);
      expect(events).toEqual([
        expect.objectContaining({
          type: "knowledge.publication.repaired",
          payload: expect.objectContaining({
            repairCommit,
            repairedCommits: [offending],
            toolGeneratedPathCount: 0,
            outsideScopePathCount: 1,
            normalizationPathCount: 0,
          }),
        }),
      ]);
      expect(forge.pullRequests).toHaveLength(1);
      // The repaired history publishes as is; the next cycle repairs nothing more.
      await publish();
      expect(events).toHaveLength(1);
    },
  );

  it(
    "restores a release-please changelog a published knowledge commit rewrote and retires its record",
    { timeout: 60_000 },
    async () => {
      // The tool's bytes carry trailing spaces the repository formatter would strip.
      const changelog =
        "# Changelog  \n\n## [1.2.0](https://example.invalid/compare) (2026-10-01)\n\n### Features\n\n* **app:** add sign-in ([#12](https://example.invalid/12))\n";
      const { root, remote, publish, events } = await setup({
        formatter: trailingSpaceFormatter,
        seed: {
          "release-please-config.json": JSON.stringify({ packages: { "apps/app": {} } }),
          ".release-please-manifest.json": JSON.stringify({ "apps/app": "1.2.0" }),
          "apps/app/CHANGELOG.md": changelog,
        },
      });
      const record =
        ".lervo/knowledge/document-normalizations/92/knormdoc_92ff6843c1236faa3d1585fd.yaml";
      await mkdir(resolve(root, ".lervo/knowledge/document-normalizations/92"), {
        recursive: true,
      });
      await writeFile(
        resolve(root, "apps/app/CHANGELOG.md"),
        "# Changelog\n\n## 1.2.0\n\n- Add Sign-In.\n",
      );
      await writeFile(
        resolve(root, record),
        `sourcePath: apps/app/CHANGELOG.md\noutputs:\n  - path: apps/app/CHANGELOG.md\n  - path: apps/app/CHANGELOG/features.md\n`,
      );
      await mkdir(resolve(root, "apps/app/CHANGELOG"), { recursive: true });
      await writeFile(resolve(root, "apps/app/CHANGELOG/features.md"), "# Features\n");
      await git(root, ["add", "-A"], knowledge);
      await git(
        root,
        ["commit", "--quiet", "-m", "docs: apply reviewed background knowledge"],
        knowledge,
      );
      const rewrite = await git(root, ["rev-parse", "HEAD"]);
      // The rewrite was already published: it sits on the remote base.
      await git(root, ["push", "--quiet", "origin", "main"]);
      await git(root, ["fetch", "--quiet", "origin"]);

      await publish();
      expect(await readFile(resolve(root, "apps/app/CHANGELOG.md"), "utf8")).toBe(changelog);
      // The publication formatter leaves the restored tool bytes alone on the published tip.
      expect(
        await git(remote, ["show", "refs/heads/lervo/knowledge-outputs:apps/app/CHANGELOG.md"]),
      ).toBe(changelog.trim());
      await expect(readFile(resolve(root, record), "utf8")).rejects.toThrow();
      await expect(
        readFile(resolve(root, "apps/app/CHANGELOG/features.md"), "utf8"),
      ).rejects.toThrow();
      expect(await git(root, ["log", "-1", "--format=%B"])).toContain(
        `Lervo-Publication-Repair: ${rewrite}`,
      );
      expect(events).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            repairedCommits: [rewrite],
            toolGeneratedPathCount: 1,
            outsideScopePathCount: 0,
            normalizationPathCount: 2,
          }),
        }),
      ]);
    },
  );

  it(
    "publishes paths inside the active delegation's roots and refuses nothing it reviewed",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish, events } = await setup({
        scope: "delegation",
        seed: { [CONVERGENCE_DELEGATION_PATH]: JSON.stringify(publicationDelegation()) },
      });
      await commit(root, "apps/site/README.md", "# Site\n\nReviewed.\n", knowledge);
      // ADR-0594: a skill publishes only from a practice commit, never from a normalization.
      await commit(
        root,
        ".agents/skills/review/SKILL.md",
        "# Review\n",
        knowledge,
        "docs: apply a reviewed practice\n\nLervo-Practice-Candidate: kprac_fixture",
      );
      expect(await publish()).toMatchObject({
        state: { status: "awaiting_checks", failure: null, commitCount: 2 },
      });
      expect(events).toEqual([]);
      expect(forge.pullRequests[0]!.body).toContain(
        "the active convergence delegation's canonical and normalization roots",
      );
    },
  );

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

  it(
    "reruns transient failures once per head, names failed checks, and backs off while nothing changes",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup({ checks: { ignore: ["Vercel – docs"] } });
      await commit(root, "docs/runtime.md", "# Runtime\n\nRetry.\n", knowledge);
      forge.checkState = "failed";
      forge.checkFailures = [
        { name: "Lint", kind: "check_run", conclusion: "not_run", runId: 11, jobId: 111 },
        { name: "Lint copy", kind: "check_run", conclusion: "not_run", runId: 11, jobId: 112 },
        { name: "Vercel – web", kind: "status", conclusion: "failure", runId: null, jobId: null },
      ];
      const start = Date.now();
      const at = (minutes: number) => () => new Date(start + minutes * 60_000);

      // ADR-0596: a job that never ran is started again once, and the publisher waits for it.
      const rerun = await publish(at(0));
      expect(rerun).toMatchObject({
        state: { status: "awaiting_checks", checksRetry: { rerun: true, attempts: 0 } },
        retryAfterMs: 120_000,
      });
      expect(forge.reruns).toEqual([{ number: 1, runIds: [11] }]);
      expect(forge.checkCalls[0]!.ignore).toEqual(["Vercel – docs"]);

      const failed = await publish(at(2));
      expect(failed).toMatchObject({
        state: {
          status: "failed",
          pullRequestNumber: 1,
          failure: {
            code: "knowledge_publication_checks_failed",
            detail:
              "3 of 3 checks failed: Lint (not_run); Lint copy (not_run); Vercel – web (failure)",
          },
          checksRetry: {
            rerun: true,
            attempts: 1,
            retryAt: new Date(start + 17 * 60_000).toISOString(),
          },
        },
      });
      expect(forge.reruns).toHaveLength(1);

      // Within the wait nothing reaches the forge.
      const reads = forge.checkCalls.length;
      expect(await publish(at(10))).toEqual({ status: "unchanged" });
      expect(forge.checkCalls).toHaveLength(reads);

      const later = await publish(at(18));
      expect(later).toMatchObject({
        state: {
          status: "failed",
          checksRetry: { attempts: 2, retryAt: new Date(start + 78 * 60_000).toISOString() },
          failure: { occurrences: 2 },
        },
      });
      expect(forge.checkCalls).toHaveLength(reads + 1);
      expect(forge.reruns).toHaveLength(1);

      // A new knowledge commit is a new head: its own rerun, and no wait inherited.
      await commit(root, "docs/runtime.md", "# Runtime\n\nRetry again.\n", knowledge);
      expect(await publish(at(20))).toMatchObject({
        state: { status: "awaiting_checks", checksRetry: { rerun: true, attempts: 0 } },
      });
      expect(forge.reruns).toHaveLength(2);
      expect((await readKnowledgePublicationState(root))?.checksRetry?.head).toBe(
        await git(root, ["rev-parse", "HEAD"]),
      );
    },
  );

  it(
    "follows a new pull request when a reopen after an expired rerun failed",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup();
      await commit(root, "docs/runtime.md", "# Runtime\n\nReopen.\n", knowledge);
      forge.checkState = "failed";
      forge.checkFailures = [
        { name: "Lint", kind: "check_run", conclusion: "not_run", runId: 31, jobId: 311 },
      ];
      // The close succeeded and both reopens failed: the pull request stays closed.
      forge.rerunEffect = async ({ number }) => {
        // As the GitHub adapter: Lervo marks the record closed by itself before it closes.
        const closed = forge.pullRequests.find((pr) => pr.number === number)!;
        closed.body = markKnowledgePublicationClosed(closed.body, "rerun");
        closed.state = "closed";
        throw new KnowledgePublicationForgeError("rerun", 1, "unknown");
      };
      const start = Date.now();
      expect(await publish(() => new Date(start))).toMatchObject({
        state: {
          status: "failed",
          pullRequestNumber: 1,
          checksRetry: { rerun: true, attempts: 1 },
          failure: { code: "knowledge_publication_checks_failed" },
        },
      });
      // After the wait the publisher opens a new pull request for the same head and follows it,
      // without a second rerun.
      forge.checkState = "pending";
      expect(await publish(() => new Date(start + 16 * 60_000))).toMatchObject({
        state: {
          status: "awaiting_checks",
          pullRequestNumber: 2,
          pullRequestUrl: "https://github.invalid/pull/2",
        },
      });
      expect(forge.pullRequests.map((pr) => pr.state)).toEqual(["closed", "open"]);
      expect(forge.reruns).toHaveLength(1);
      expect(await readKnowledgePublicationState(root)).toMatchObject({ pullRequestNumber: 2 });
    },
  );

  it(
    "never reruns a real failure or an outside status, and still backs it off",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup();
      await commit(root, "docs/runtime.md", "# Runtime\n\nReal.\n", knowledge);
      forge.checkState = "failed";
      forge.checkFailures = [
        { name: "Test", kind: "check_run", conclusion: "failure", runId: 21, jobId: 211 },
        { name: "Preview", kind: "status", conclusion: "error", runId: null, jobId: null },
      ];
      const start = Date.now();
      expect(await publish(() => new Date(start))).toMatchObject({
        state: {
          status: "failed",
          checksRetry: { rerun: false, attempts: 1 },
          failure: { detail: "2 of 2 checks failed: Test (failure); Preview (error)" },
        },
      });
      expect(forge.reruns).toEqual([]);
      expect(await publish(() => new Date(start + 5 * 60_000))).toEqual({ status: "unchanged" });
    },
  );

  it("does nothing on a non-owner and reports a push failure as attention", async () => {
    const { root, remote, publish, owner } = await setup();
    await commit(root, "docs/runtime.md", "# Runtime\n\nC.\n", knowledge);
    await owner("waiting_owner");
    expect(await publish()).toEqual({ status: "not_owner" });
    await owner("owner");
    await rm(remote, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    expect(await publish()).toMatchObject({
      state: { status: "failed", failure: { code: "knowledge_publication_fetch_failed" } },
    });
    expect(await readKnowledgePublicationState(root)).toMatchObject({ status: "failed" });
  });

  it(
    "replays identical input to an identical tip, pushes once across cycles, and merges after checks pass",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      await commit(root, "docs/runtime.md", "# Runtime\n\nOwner.\n", knowledge);
      // origin/main moved, so every cycle replays the commit onto the remote base.
      await advanceRemoteMain(remote, "docs/other.md", "# Other\n");
      const first = await publish();
      expect(first).toMatchObject({ state: { status: "awaiting_checks", pullRequestNumber: 1 } });
      const published = await git(remote, ["rev-parse", "refs/heads/lervo/knowledge-outputs"]);
      expect(published).not.toBe(await git(root, ["rev-parse", "HEAD"]));
      const rawDates = "--format=%ad|%cd";
      expect(await git(remote, ["log", "-1", "--date=raw", rawDates, published])).toBe(
        await git(root, ["log", "-1", "--date=raw", rawDates, "HEAD"]),
      );
      // Replay on a later wall-clock second must not mint a new commit hash.
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_100));
      const second = await publish();
      expect(second).toMatchObject({
        state: { status: "awaiting_checks", publishedHead: published, failure: null },
      });
      expect(await remoteBranchUpdates(remote)).toBe(1);

      forge.checkState = "passed";
      expect(await publish()).toMatchObject({ state: { status: "merged" } });
      expect(forge.merges).toBe(1);
      expect(await remoteBranchUpdates(remote)).toBe(1);
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(await remoteMain(remote));
    },
  );

  it(
    "keeps an equivalent remote publication head instead of force-pushing the same patches",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      await commit(root, "docs/runtime.md", "# Runtime\n\nOwner.\n", knowledge);
      const local = await git(root, ["rev-parse", "HEAD"]);
      await advanceRemoteMain(remote, "docs/other.md", "# Other\n");
      // An earlier publisher replayed the same commit with its own committer date.
      await git(root, ["fetch", "--quiet", "origin"]);
      await git(root, ["checkout", "--quiet", "--detach", "origin/main"]);
      await git(root, ["cherry-pick", local], {
        ...knowledge,
        GIT_COMMITTER_DATE: "1700000000 +0000",
      });
      const earlier = await git(root, ["rev-parse", "HEAD"]);
      await git(root, [
        "push",
        "--quiet",
        "origin",
        `${earlier}:refs/heads/lervo/knowledge-outputs`,
      ]);
      await git(root, ["checkout", "--quiet", "main"]);

      expect(await publish()).toMatchObject({
        state: { status: "awaiting_checks", publishedHead: earlier },
      });
      expect(await git(remote, ["rev-parse", "refs/heads/lervo/knowledge-outputs"])).toBe(earlier);
      expect(await remoteBranchUpdates(remote)).toBe(1);
      forge.checkState = "passed";
      expect(await publish()).toMatchObject({
        state: { status: "merged", publishedHead: earlier },
      });
      expect(forge.merges).toBe(1);
    },
  );

  it(
    "treats a merge refused for pending checks as waiting, and records gh failure details",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup();
      await commit(root, "docs/runtime.md", "# Runtime\n\nOwner.\n", knowledge);
      forge.checkState = "passed";
      forge.mergeError = new KnowledgePublicationForgeError("merge", 1, "checks_pending");
      expect(await publish()).toMatchObject({
        state: { status: "awaiting_checks", failure: null },
        retryAfterMs: 120_000,
      });
      expect(forge.merges).toBe(0);

      forge.mergeError = new KnowledgePublicationForgeError("merge", 1, "not_mergeable");
      expect(await publish()).toMatchObject({
        state: {
          status: "failed",
          pullRequestNumber: 1,
          failure: {
            code: "knowledge_publication_merge_failed",
            detail: "gh merge exit 1 not_mergeable",
          },
        },
      });

      forge.mergeError = null;
      forge.findError = new KnowledgePublicationForgeError("find", 4, "auth");
      expect(await publish()).toMatchObject({
        state: {
          status: "failed",
          failure: {
            code: "knowledge_publication_pull_request_failed",
            detail: "gh find exit 4 auth",
          },
        },
      });
    },
  );

  it(
    "formats unformatted and released paths in one deterministic commit before publishing",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup({ formatter: trailingSpaceFormatter });
      const record = ".lervo/knowledge/document-normalizations/aa/knormdoc_a.yaml";
      // The base holds a lifecycle-owned document with bytes the formatter would change.
      const seed = resolve(root, "..", "seed");
      await commit(seed, "docs/owned.md", "# Owned  \n", developer, "docs: seed owned");
      await commit(
        seed,
        record,
        "schemaVersion: 2\noutputs:\n  - path: docs/owned.md\n",
        developer,
        "docs: seed record",
      );
      await git(seed, ["push", "--quiet", "origin", "main"]);
      await git(root, ["pull", "--quiet", "--ff-only"]);
      // Convergence retires the record, releasing docs/owned.md, and writes an unformatted output.
      await git(root, ["rm", "--quiet", "--", record], knowledge);
      await git(
        root,
        ["commit", "--quiet", "-m", "docs: retire a normalization record"],
        knowledge,
      );
      await commit(root, "docs/runtime.md", "# Runtime  \n\nOwner.  \n", knowledge);
      const head = await git(root, ["rev-parse", "HEAD"]);

      const first = await publish();
      expect(first).toMatchObject({ state: { status: "awaiting_checks", commitCount: 2 } });
      const tip = await git(remote, ["rev-parse", "refs/heads/lervo/knowledge-outputs"]);
      expect(await git(remote, ["rev-parse", `${tip}^`])).toBe(head);
      expect(await git(remote, ["log", "-1", "--format=%an|%cn|%s", tip])).toBe(
        "Lervo Knowledge|Lervo Knowledge|docs: format published background knowledge",
      );
      const body = await git(remote, ["log", "-1", "--format=%b", tip]);
      expect(body).toContain("formatted 2 path(s)");
      expect(body.split("\n").every((line) => line.length <= 100)).toBe(true);
      expect(await git(remote, ["show", `${tip}:docs/runtime.md`])).toBe("# Runtime\n\nOwner.");
      expect(await git(remote, ["show", `${tip}:docs/owned.md`])).toBe("# Owned");
      expect(forge.pullRequests[0]!.body).toContain("formats 2 paths");

      await new Promise((resolveWait) => setTimeout(resolveWait, 1_100));
      await publish();
      expect(await remoteBranchUpdates(remote)).toBe(1);
      forge.checkState = "passed";
      expect(await publish()).toMatchObject({ state: { status: "merged" } });
      // The formatting commit sits on top of the local commits, so local main fast-forwards.
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(await remoteMain(remote));
    },
  );
});

/** Strips trailing spaces from Markdown; every other path is not the formatter's. */
const trailingSpaceFormatter: KnowledgeOutputFormatter = {
  format: async (path, content) =>
    path.endsWith(".md") ? content.replace(/[ \t]+$/gmu, "") : null,
};

const remoteBranchUpdates = async (remote: string) =>
  (await git(remote, ["reflog", "show", "--format=%H", "refs/heads/lervo/knowledge-outputs"]))
    .split("\n")
    .filter((line) => line !== "").length;

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
          committerDate: "1791211446 +0900",
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
      head: "b".repeat(40),
      method: "squash",
    });
    expect(body.split("\n").filter((line) => line.startsWith("## "))).toEqual(headings);
    expect(body).not.toMatch(/^# /mu);
    // ADR-0603: the only comment is the closing publication record, which names what it carries.
    const record = body.indexOf("<!-- lervo-publication-record");
    expect(body.slice(0, record)).not.toContain("<!--");
    expect(parseKnowledgePublicationRecord(body)).toEqual({
      head: "b".repeat(40),
      commits: ["a".repeat(40)],
      closed: null,
    });
    // The body says the method the policy chose, not a fixed one.
    expect(body).toContain("merges this pull request as one squashed commit");
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
    ).toMatchObject({ state: "pending", reason: "head_moved" });
    // ADR-0603: no check at all is pending for a named reason, so its wait can say why.
    expect(
      summarizeKnowledgePublicationChecks({ headSha: "a", observedHeadSha: "a", rollup: [] }),
    ).toMatchObject({ state: "pending", reason: "none" });
    expect(
      summarizeKnowledgePublicationChecks({
        headSha: "a",
        observedHeadSha: "a",
        rollup: [success, { __typename: "CheckRun", status: "QUEUED", conclusion: "" }],
      }),
    ).toMatchObject({ state: "pending", reason: "running" });
    expect(
      summarizeKnowledgePublicationChecks({
        headSha: "a",
        observedHeadSha: "a",
        rollup: [success, { __typename: "StatusContext", context: "preview", state: "FAILURE" }],
      }),
    ).toEqual({
      state: "failed",
      total: 2,
      failed: 1,
      failures: [
        { name: "preview", kind: "status", conclusion: "failure", runId: null, jobId: null },
      ],
    });
    expect(
      summarizeKnowledgePublicationChecks({
        headSha: "a",
        observedHeadSha: "a",
        rollup: [success],
      }),
    ).toEqual({ state: "passed", total: 1 });
  });

  it("merges only when every applicable check succeeded", () => {
    const run = (conclusion: string) => ({
      __typename: "CheckRun",
      status: "COMPLETED",
      conclusion,
    });
    const summarize = (rollup: unknown[]) =>
      summarizeKnowledgePublicationChecks({ headSha: "a", observedHeadSha: "a", rollup });
    for (const conclusion of [
      "NEUTRAL",
      "CANCELLED",
      "FAILURE",
      "TIMED_OUT",
      "ACTION_REQUIRED",
      "STALE",
      "STARTUP_FAILURE",
    ])
      expect(summarize([run("SUCCESS"), run(conclusion)])).toMatchObject({
        state: "failed",
        total: 2,
        failed: 1,
        failures: [{ name: "unnamed check", conclusion: conclusion.toLowerCase() }],
      });
    expect(
      summarize([run("SUCCESS"), { __typename: "StatusContext", state: "ERROR" }]),
    ).toMatchObject({ state: "failed", total: 2, failed: 1 });
    // A job the workflow skipped for pull requests neither passes nor blocks.
    expect(summarize([run("SUCCESS"), run("SKIPPED")])).toEqual({ state: "passed", total: 2 });
    expect(summarize([run("SKIPPED")])).toEqual({
      state: "pending",
      total: 1,
      reason: "skipped_only",
    });
    expect(
      summarize([run("SUCCESS"), { __typename: "StatusContext", state: "EXPECTED" }]),
    ).toMatchObject({ state: "pending" });
  });
});

describe("named publication check failures", () => {
  it("names at most eight failures, drops ignored names, and keeps the full count", () => {
    const failing = Array.from({ length: 10 }, (_, index) => ({
      __typename: "CheckRun",
      name: `job ${index}\u0007`,
      status: "COMPLETED",
      conclusion: "FAILURE",
      detailsUrl: `https://github.com/o/r/actions/runs/${index + 1}/job/${index + 100}`,
    }));
    const summary = summarizeKnowledgePublicationChecks({
      headSha: "a",
      observedHeadSha: "a",
      rollup: [...failing, { __typename: "StatusContext", context: "Preview", state: "FAILURE" }],
      ignore: ["Preview"],
    });
    expect(summary).toMatchObject({ state: "failed", total: 10, failed: 10 });
    const failures = summary.state === "failed" ? summary.failures : [];
    expect(failures).toHaveLength(8);
    expect(failures[0]).toEqual({
      name: "job 0",
      kind: "check_run",
      conclusion: "failure",
      runId: 1,
      jobId: 100,
    });
    // Ignoring every failed item leaves only successes, which pass.
    expect(
      summarizeKnowledgePublicationChecks({
        headSha: "a",
        observedHeadSha: "a",
        rollup: [
          { __typename: "CheckRun", name: "Build", status: "COMPLETED", conclusion: "SUCCESS" },
          { __typename: "StatusContext", context: "Preview", state: "FAILURE" },
        ],
        ignore: ["Preview"],
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
    await forge.updatePullRequest({ number: 12, title: "t2", body: "b2" });
    expect(calls.at(-1)).toEqual({
      args: ["api", "--method", "PATCH", "repos/{owner}/{repo}/pulls/12", "--input", "-"],
      input: JSON.stringify({ title: "t2", body: "b2" }),
    });
    await forge.closePullRequest({ number: 12, comment: "superseded" });
    expect(calls.at(-1)!.args).toEqual(["pr", "close", "12", "--comment", "superseded"]);
    await forge.merge({ number: 12, headSha: "b".repeat(40), method: "merge" });
    expect(calls.find((call) => call.args[1] === "create")).toMatchObject({ input: "b" });
    expect(calls.at(-1)!.args).toEqual([
      "pr",
      "merge",
      "12",
      "--merge",
      "--match-head-commit",
      "b".repeat(40),
    ]);
    // ADR-0603: the method the repository policy allows, always for the exact head.
    for (const method of ["squash", "rebase"] as const) {
      await forge.merge({ number: 12, headSha: "b".repeat(40), method });
      expect(calls.at(-1)!.args).toEqual([
        "pr",
        "merge",
        "12",
        `--${method}`,
        "--match-head-commit",
        "b".repeat(40),
      ]);
    }
  });

  it("names never-started jobs, ignores listed names, and reopens when GitHub refuses a rerun", async () => {
    const calls: string[][] = [];
    const head = "b".repeat(40);
    const rollup = [
      {
        __typename: "CheckRun",
        name: "Lint",
        status: "COMPLETED",
        conclusion: "FAILURE",
        detailsUrl: "https://github.com/o/r/actions/runs/11/job/111",
      },
      {
        __typename: "CheckRun",
        name: "Test",
        status: "COMPLETED",
        conclusion: "FAILURE",
        detailsUrl: "https://github.com/o/r/actions/runs/12/job/121",
      },
      { __typename: "StatusContext", context: "Vercel – web", state: "FAILURE" },
      { __typename: "CheckRun", name: "Build", status: "COMPLETED", conclusion: "SUCCESS" },
    ];
    const forge = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      run: async (args) => {
        calls.push(args);
        if (viewsBody(args)) return RECORDED_BODY;
        if (args[0] === "pr" && args[1] === "view")
          return JSON.stringify({ headRefOid: head, statusCheckRollup: rollup });
        // A job GitHub refused to start has no steps.
        if (args[0] === "api") return args[1]!.endsWith("/111") ? "0\n" : "3\n";
        if (args[0] === "run" && args[2] === "12")
          throw Object.assign(new Error("Command failed: gh"), {
            code: 1,
            stderr: "run was created over a month ago",
          });
        return "";
      },
    });
    expect(await forge.checks({ number: 64, headSha: head })).toEqual({
      state: "failed",
      total: 4,
      failed: 3,
      failures: [
        { name: "Lint", kind: "check_run", conclusion: "not_run", runId: 11, jobId: 111 },
        { name: "Test", kind: "check_run", conclusion: "failure", runId: 12, jobId: 121 },
        { name: "Vercel – web", kind: "status", conclusion: "failure", runId: null, jobId: null },
      ],
    });
    expect(
      await forge.checks({ number: 64, headSha: head, ignore: ["Vercel – web"] }),
    ).toMatchObject({ state: "failed", total: 3, failed: 2 });
    calls.length = 0;
    await forge.rerunFailedChecks({ number: 64, runIds: [11] });
    expect(calls).toEqual([
      ["api", "repos/{owner}/{repo}/actions/runs/11", "--jq", ".created_at"],
      ["run", "rerun", "11", "--failed"],
    ]);
    calls.length = 0;
    await forge.rerunFailedChecks({ number: 64, runIds: [12] });
    expect(calls).toEqual([
      ["api", "repos/{owner}/{repo}/actions/runs/12", "--jq", ".created_at"],
      ["run", "rerun", "12", "--failed"],
      // ADR-0603: the record says Lervo closed it, so no host reads it as a person's decision.
      ...MARK_CLOSED(64),
      ["pr", "close", "64"],
      ["pr", "reopen", "64"],
    ]);
    // An Actions job is never ignored, even when a commit status of the same name is.
    expect(
      await forge.checks({ number: 64, headSha: head, ignore: ["Lint", "Vercel – web"] }),
    ).toMatchObject({ state: "failed", total: 3, failed: 2 });
  });

  it("closes a pull request only when GitHub refused a rerun as too old, and retries a reopen", async () => {
    const calls: string[][] = [];
    let reopenFailures = 1;
    const patched: string[] = [];
    const forge = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      run: async (args, input) => {
        calls.push(args);
        if (viewsBody(args)) return RECORDED_BODY;
        if (args.includes("PATCH")) patched.push(input!);
        if (args[0] === "run" && args[2] === "40")
          throw Object.assign(new Error("Command failed: gh"), {
            code: 1,
            stderr: "HTTP 403: Resource not accessible by integration",
          });
        if (args[0] === "run" && args[2] === "41")
          throw Object.assign(new Error("Command failed: gh"), {
            code: 1,
            stderr: "run 41 cannot be rerun; This workflow run is not retryable",
          });
        if (args[1] === "reopen" && reopenFailures-- > 0)
          throw Object.assign(new Error("Command failed: gh"), { code: 1, stderr: "timeout" });
        return "";
      },
    });
    const refused = await forge.rerunFailedChecks({ number: 7, runIds: [41, 40] }).then(
      () => null,
      (error: unknown) => error as KnowledgePublicationForgeError,
    );
    expect(refused).toBeInstanceOf(KnowledgePublicationForgeError);
    expect(refused!.detail).toMatch(/^gh rerun exit 1 auth(?::|$)/u);
    expect(calls.some((args) => args[1] === "close")).toBe(false);
    calls.length = 0;
    await forge.rerunFailedChecks({ number: 7, runIds: [41] });
    expect(calls).toEqual([
      ["api", "repos/{owner}/{repo}/actions/runs/41", "--jq", ".created_at"],
      ["run", "rerun", "41", "--failed"],
      ...MARK_CLOSED(7),
      ["pr", "close", "7"],
      ["pr", "reopen", "7"],
      ["pr", "reopen", "7"],
    ]);
    expect(
      parseKnowledgePublicationRecord((JSON.parse(patched[0]!) as { body: string }).body),
    ).toMatchObject({ closed: "rerun" });
  });

  it("reads the closed history, the GraphQL gate and a queue merge through gh (ADR-0603)", async () => {
    const calls: string[][] = [];
    const record = renderKnowledgePublicationRecord({
      head: "a".repeat(40),
      commits: ["b".repeat(40)],
    });
    const at = "2026-11-21T00:00:00Z";
    let history = `${JSON.stringify({ number: 3, merged: true, mergeCommit: "c".repeat(40), mergedAt: at, updatedAt: at, headSha: "a".repeat(40), record })}\n${JSON.stringify({ number: 2, merged: false, mergeCommit: null, mergedAt: null, updatedAt: at, headSha: "d".repeat(40), record: "" })}\n`;
    const forge = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      run: async (args) => {
        calls.push(args);
        if (args[0] === "api" && args[1]!.includes("/pulls?")) return history;
        if (args[1] === "graphql")
          return JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  mergeStateStatus: "CLEAN",
                  reviewDecision: null,
                  isDraft: false,
                  isInMergeQueue: false,
                  isMergeQueueEnabled: true,
                },
              },
            },
          });
        return "";
      },
    });
    await expect(
      forge.publicationHistory({ head: "lervo/knowledge-outputs", base: "main" }),
    ).resolves.toEqual([
      {
        number: 3,
        merged: true,
        mergeCommit: "c".repeat(40),
        mergedAt: at,
        updatedAt: at,
        headSha: "a".repeat(40),
        record,
      },
      {
        number: 2,
        merged: false,
        mergeCommit: null,
        mergedAt: null,
        updatedAt: at,
        headSha: "d".repeat(40),
        record: "",
      },
    ]);
    expect(calls[0]!.slice(0, 2)).toEqual([
      "api",
      "repos/{owner}/{repo}/pulls?state=all&head={owner}:lervo%2Fknowledge-outputs&base=main&sort=updated&direction=desc&per_page=100&page=1",
    ]);
    // A classic merge queue no rule reports still shows on the pull request.
    await expect(forge.gate(5)).resolves.toBe("queue");
    await forge.merge({ number: 5, headSha: "e".repeat(40), method: "queue" });
    expect(calls.at(-1)).toEqual(["pr", "merge", "5", "--match-head-commit", "e".repeat(40)]);
    await forge.merge({ number: 5, headSha: "e".repeat(40), method: "squash" });
    expect(calls.at(-1)).toEqual([
      "pr",
      "merge",
      "5",
      "--squash",
      "--match-head-commit",
      "e".repeat(40),
    ]);
    // A malformed history entry is an invalid response, never a guess.
    history = `${JSON.stringify({ number: 4, merged: "yes" })}\n`;
    await expect(
      forge.publicationHistory({ head: "lervo/knowledge-outputs", base: "main" }),
    ).rejects.toMatchObject({ operation: "history", failureClass: "invalid_response" });
  });

  it("counts only the newest run of each Actions check after a rerun or reopen", () => {
    const head = "a".repeat(40);
    const run = (name: string, workflowName: string, startedAt: string, conclusion: string) => ({
      __typename: "CheckRun",
      name,
      workflowName,
      status: "COMPLETED",
      conclusion,
      startedAt,
      completedAt: startedAt,
    });
    const rollup = [
      run("Lint", "Code Quality", "2026-10-12T17:11:01Z", "FAILURE"),
      run("Validate PR title", "PR Title", "2026-10-12T17:11:01Z", "FAILURE"),
      run("Validate PR title", "PR Title", "2026-10-12T17:11:02Z", "FAILURE"),
      run("Lint", "Code Quality", "2026-11-20T02:02:26Z", "SUCCESS"),
      run("Validate PR title", "PR Title", "2026-11-20T02:02:26Z", "SUCCESS"),
      { __typename: "StatusContext", context: "Vercel", state: "FAILURE" },
    ];
    expect(
      summarizeKnowledgePublicationChecks({
        headSha: head,
        observedHeadSha: head,
        rollup,
        ignore: ["Vercel"],
      }),
    ).toEqual({ state: "passed", total: 2 });
    // A job of the same name in another workflow is its own check.
    expect(
      summarizeKnowledgePublicationChecks({
        headSha: head,
        observedHeadSha: head,
        rollup: [...rollup, run("Lint", "Nightly", "2026-10-01T00:00:00Z", "FAILURE")],
        ignore: ["Vercel"],
      }),
    ).toMatchObject({ state: "failed", failed: 1, failures: [{ name: "Lint" }] });
  });

  it("treats a run older than a month as expired whatever gh calls the refusal", async () => {
    const calls: string[][] = [];
    const forge = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      now: () => new Date("2026-11-20T02:00:00.000Z"),
      run: async (args) => {
        calls.push(args);
        if (viewsBody(args)) return RECORDED_BODY;
        if (args[0] === "api" && args[1]!.endsWith("/38282516554")) return "2026-10-12T17:11:01Z\n";
        if (args[0] === "api") return "2026-11-19T00:00:00Z\n";
        // gh 2.46 words GitHub's refusal of an old run as a broken workflow file.
        if (args[0] === "run")
          throw Object.assign(new Error("Command failed: gh"), {
            code: 1,
            stderr: "run 9 cannot be rerun; its workflow file may be broken",
          });
        return "";
      },
    });
    await forge.rerunFailedChecks({ number: 64, runIds: [38282516554] });
    expect(calls).toEqual([
      ["api", "repos/{owner}/{repo}/actions/runs/38282516554", "--jq", ".created_at"],
      ...MARK_CLOSED(64),
      ["pr", "close", "64"],
      ["pr", "reopen", "64"],
    ]);
    // A recent run refused with the same words is not expired, so nothing is closed.
    calls.length = 0;
    await expect(forge.rerunFailedChecks({ number: 64, runIds: [9] })).rejects.toBeInstanceOf(
      KnowledgePublicationForgeError,
    );
    expect(calls.some((args) => args[1] === "close")).toBe(false);
  });

  it("reports each gh failure as its step, exit code, closed class, and GitHub's redacted reason", async () => {
    const failing = (stderr: string, code: number | string = 1) =>
      createGitHubKnowledgePublicationForge({
        repositoryRoot: "/repository",
        run: async () => {
          throw Object.assign(new Error("Command failed: gh"), { code, stderr });
        },
      });
    const failure = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (error: unknown) => error as KnowledgePublicationForgeError,
      );
    const cases: [Promise<unknown>, string][] = [
      [
        failing(
          "X Pull request #49 is not mergeable: the merge commit cannot be cleanly created.",
        ).merge({ number: 49, headSha: "b".repeat(40), method: "merge" }),
        "gh merge exit 1 not_mergeable: X Pull request #49 is not mergeable: the merge commit cannot be cleanly created.",
      ],
      [
        failing('X Required status check "quality" is expected.').merge({
          number: 49,
          headSha: "b".repeat(40),
          method: "merge",
        }),
        'gh merge exit 1 checks_pending: X Required status check "quality" is expected.',
      ],
      [
        // The flemo refusal (ADR-0603): squash-only, and before this release the detail was "unknown".
        failing(
          "GraphQL: Merge commits are not allowed on this repository. (mergePullRequest)",
        ).merge({
          number: 557,
          headSha: "b".repeat(40),
          method: "merge",
        }),
        "gh merge exit 1 method_not_allowed: GraphQL: Merge commits are not allowed on this repository. (mergePullRequest)",
      ],
      [
        failing("HTTP 401: Bad credentials (https://api.github.com/graphql)", 4).findPullRequest({
          head: "lervo/knowledge-outputs",
          base: "main",
        }),
        "gh find exit 4 auth: HTTP 401: Bad credentials (https://api.github.com/graphql)",
      ],
      [
        failing("error connecting to api.github.com: dial tcp: i/o timeout").checks({
          number: 49,
          headSha: "b".repeat(40),
        }),
        "gh checks exit 1 network: error connecting to api.github.com: dial tcp: i/o timeout",
      ],
      [
        failing(
          "fatal: unable to access 'https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz@github.com/o/r'\nGraphQL: something unexpected",
        ).updatePullRequest({
          number: 49,
          title: "t",
          body: "b",
        }),
        "gh update exit 1 unknown: fatal: unable to access 'https://github.com/o/r' | GraphQL: something unexpected",
      ],
      [
        failing("", "ENOENT").closePullRequest({ number: 49, comment: "c" }),
        "gh close exit unknown not_installed",
      ],
    ];
    for (const [promise, detail] of cases) {
      const error = await failure(promise);
      expect(error).toBeInstanceOf(KnowledgePublicationForgeError);
      expect(error!.detail).toBe(detail);
      expect(error!.message).not.toContain("api.github.com");
    }
    const invalid = createGitHubKnowledgePublicationForge({
      repositoryRoot: "/repository",
      run: async () => "{not json",
    });
    expect((await failure(invalid.viewPullRequest(49)))!.detail).toBe(
      "gh view exit unknown invalid_response",
    );
  });
});
