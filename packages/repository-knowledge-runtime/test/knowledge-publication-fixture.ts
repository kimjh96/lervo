import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect } from "vitest";

import { writeConvergenceOwnerFence } from "../src/convergence-owner-fence.js";
import { CONVERGENCE_OWNER_HOST_PATH } from "../src/convergence-owner-host.js";
import type {
  KnowledgePublicationCheckFailure,
  KnowledgePublicationChecks,
  KnowledgePublicationForge,
  KnowledgePublicationHistoryEntry,
  KnowledgePublicationMergeGate,
  KnowledgePublicationPendingReason,
  KnowledgePublicationPullRequest,
} from "../src/knowledge-publication-forge.js";
import type { KnowledgeOutputFormatter } from "../src/knowledge-output-formatter.js";
import { publishKnowledgeOutputs } from "../src/knowledge-publication.js";
import { markKnowledgePublicationClosed } from "../src/knowledge-publication-history.js";
import type {
  KnowledgePublicationMergeMethod,
  KnowledgePublicationPolicy,
} from "../src/knowledge-publication-policy.js";
import type { KnowledgePublicationRepairEvents } from "../src/knowledge-publication-repair.js";
import {
  convergenceDelegationPlanHash,
  type ConvergenceDelegation,
} from "../src/delegation-contract.js";

/** Shared fixture for the knowledge publication tests: a bare remote, an owner clone, a fake forge. */
export const execute = promisify(execFile);
export const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })),
  );
});

export const developer = {
  GIT_AUTHOR_NAME: "Developer",
  GIT_AUTHOR_EMAIL: "dev@example.com",
  GIT_COMMITTER_NAME: "Developer",
  GIT_COMMITTER_EMAIL: "dev@example.com",
};
export const knowledge = {
  GIT_AUTHOR_NAME: "Lervo Knowledge",
  GIT_AUTHOR_EMAIL: "knowledge@lervo.invalid",
  GIT_COMMITTER_NAME: "Lervo Knowledge",
  GIT_COMMITTER_EMAIL: "knowledge@lervo.invalid",
};

export async function git(root: string, args: string[], env: NodeJS.ProcessEnv = developer) {
  const { stdout } = await execute("git", ["-C", root, ...args], {
    env: { ...process.env, ...env },
  });
  return stdout.trim();
}

export async function commit(
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
export class FakeForge implements KnowledgePublicationForge {
  pullRequests: (KnowledgePublicationPullRequest & {
    head: string;
    base: string;
    mergedAt?: string | null;
    updatedAt?: string;
  })[] = [];
  /** ADR-0607: the repository the fake targets, which keys the cached history. */
  repositoryName = "example/repository";
  async repository() {
    return this.repositoryName;
  }
  /** As GitHub's `updated_at`: every change of a pull request moves it. */
  private touch(pr: { updatedAt?: string }) {
    pr.updatedAt = new Date().toISOString();
  }
  checkState: KnowledgePublicationChecks["state"] = "pending";
  /** Why pending checks are pending. */
  pendingReason: KnowledgePublicationPendingReason = "running";
  /** False models GitHub reporting MERGED before it reports the merge commit. */
  mergeCommitReported = true;
  /** Pull requests in the merge queue, by number. */
  queued = new Set<number>();
  merges = 0;
  /** ADR-0603: the repository policy the forge reports, by default one that allows everything. */
  policyValue: KnowledgePublicationPolicy = {
    mergeMethods: ["merge", "squash", "rebase"],
    excluded: [],
    requiredChecks: [],
    strict: false,
    reviewRequired: false,
    mergeQueue: false,
    baseRefusals: [],
    branchRefusals: [],
  };
  policyCalls = 0;
  /** What stands before a merge once checks passed; a function sees the live pull request. */
  gateValue: KnowledgePublicationMergeGate | (() => Promise<KnowledgePublicationMergeGate>) =
    "ready";
  /** Whether a merge command lands; false models one that succeeds without merging. */
  mergeLands = true;
  /** The method of each merge, in order. */
  mergeMethods: (KnowledgePublicationMergeMethod | "queue")[] = [];

  constructor(
    private readonly remote: string,
    private readonly scratch: string,
  ) {}

  private async head(branch: string) {
    return (await git(this.remote, ["rev-parse", `refs/heads/${branch}`])).trim();
  }

  async findPullRequest({ head, base }: { head: string; base: string }) {
    if (this.findError !== null) throw this.findError;
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
      mergeCommit: null as string | null,
      mergedAt: null as string | null,
      updatedAt: new Date().toISOString(),
    };
    this.pullRequests.push(created);
    return created;
  }
  updateError: Error | null = null;
  async updatePullRequest(input: { number: number; title: string; body: string }) {
    if (this.updateError !== null) throw this.updateError;
    const found = this.pullRequests.find((pr) => pr.number === input.number)!;
    found.title = input.title;
    found.body = input.body;
    this.touch(found);
  }
  async viewPullRequest(number: number) {
    const found = this.pullRequests.find((pr) => pr.number === number);
    if (found === undefined) throw new Error("pull request not found");
    return found;
  }
  closed: { number: number; comment: string }[] = [];
  /** As the GitHub adapter: Lervo marks the record closed by itself, then closes. */
  async closePullRequest(input: { number: number; comment: string }) {
    const found = this.pullRequests.find((pr) => pr.number === input.number)!;
    found.body = markKnowledgePublicationClosed(found.body, "superseded");
    found.headSha = await this.head(found.head);
    found.state = "closed";
    this.touch(found);
    this.closed.push(input);
  }
  /** How each closed pull request was closed, as GitHub's issue events tell it. */
  closures = new Map<number, "person" | "branch_deleted">();
  /** A person closes the pull request without merging it. */
  async closeByPerson(number: number) {
    const found = this.pullRequests.find((pr) => pr.number === number)!;
    found.headSha = await this.head(found.head);
    found.state = "closed";
    this.touch(found);
    this.closures.set(number, "person");
  }
  /** A person deletes the publication branch, and GitHub closes its pull request. */
  async deleteBranchByPerson(number: number) {
    const found = this.pullRequests.find((pr) => pr.number === number)!;
    found.headSha = await this.head(found.head);
    found.state = "closed";
    this.touch(found);
    this.closures.set(number, "branch_deleted");
    await git(this.remote, ["update-ref", "-d", `refs/heads/${found.head}`]);
  }
  async closureCause(number: number) {
    return this.closures.get(number) ?? "person";
  }
  historyCalls = 0;
  /** Closed pull requests with the head each had when it closed, as GitHub lists them. */
  /** Pull requests whose `refs/pull/<n>/head` the fake does not serve. */
  unservedPullHeads = new Set<number>();
  /** The `since` of each history read, in order. */
  historySince: (string | undefined)[] = [];
  async publicationHistory({
    head,
    base,
    since,
  }: {
    head: string;
    base: string;
    since?: string;
  }): Promise<KnowledgePublicationHistoryEntry[]> {
    this.historySince.push(since);
    this.historyCalls++;
    // As GitHub: every pull request keeps `refs/pull/<n>/head`, at its head when it closed,
    // except the ones a test says GitHub does not serve.
    for (const pr of this.pullRequests) {
      if (this.unservedPullHeads.has(pr.number)) {
        await git(this.remote, ["update-ref", "-d", `refs/pull/${pr.number}/head`]).catch(() => "");
        continue;
      }
      const head =
        pr.state === "open" ? await this.head(pr.head).catch(() => pr.headSha) : pr.headSha;
      await git(this.remote, ["update-ref", `refs/pull/${pr.number}/head`, head]);
    }
    return this.pullRequests
      .filter((pr) => pr.head === head && pr.base === base)
      .map((pr) => ({ ...pr, updatedAt: pr.updatedAt ?? new Date(0).toISOString() }))
      .filter((pr) => since === undefined || pr.updatedAt >= since)
      .map((pr) => ({
        number: pr.number,
        merged: pr.state === "merged",
        headSha: pr.headSha,
        mergeCommit: pr.state === "merged" ? pr.mergeCommit : null,
        mergedAt: pr.state === "merged" ? (pr.mergedAt ?? pr.updatedAt) : null,
        updatedAt: pr.updatedAt,
        record: pr.body,
        ...(pr.state === "open" ? { open: true } : {}),
      }));
  }
  checkFailures: KnowledgePublicationCheckFailure[] = [];
  checkCalls: {
    headSha: string;
    ignore: readonly string[] | undefined;
    required?: readonly string[];
  }[] = [];
  async checks({
    number,
    headSha,
    ignore,
    required,
  }: {
    number: number;
    headSha: string;
    ignore?: readonly string[];
    required?: readonly string[];
  }): Promise<KnowledgePublicationChecks> {
    this.checkCalls.push({ headSha, ignore, ...(required === undefined ? {} : { required }) });
    const found = this.pullRequests.find((pr) => pr.number === number)!;
    if ((await this.head(found.head)) !== headSha)
      return { state: "pending", total: 1, reason: "head_moved" };
    return this.checkState === "failed"
      ? {
          state: "failed",
          total: Math.max(2, this.checkFailures.length),
          failed: Math.max(1, this.checkFailures.length),
          failures: this.checkFailures,
        }
      : this.checkState === "pending"
        ? { state: "pending", total: 2, reason: this.pendingReason }
        : { state: this.checkState, total: 2 };
  }
  reruns: { number: number; runIds: readonly number[] }[] = [];
  rerunEffect: ((input: { number: number }) => Promise<void>) | null = null;
  async rerunFailedChecks(input: { number: number; runIds: readonly number[] }) {
    this.reruns.push(input);
    if (this.rerunEffect !== null) await this.rerunEffect(input);
  }
  mergeError: Error | null = null;
  findError: Error | null = null;
  async policy() {
    this.policyCalls++;
    return structuredClone(this.policyValue);
  }
  async gate() {
    return typeof this.gateValue === "function" ? this.gateValue() : this.gateValue;
  }
  /**
   * Lands the pull request as GitHub would for `method`: a merge commit; one new commit with the
   * head's tree by a developer identity (a squash); or the head's commits replayed as new commits.
   */
  async merge({
    number,
    headSha,
    method,
  }: {
    number: number;
    headSha: string;
    method: KnowledgePublicationMergeMethod | "queue";
  }) {
    if (this.mergeError !== null) throw this.mergeError;
    const found = this.pullRequests.find((pr) => pr.number === number)!;
    expect(await this.head(found.head)).toBe(headSha);
    if (method === "queue") {
      this.queued.add(number);
      this.mergeMethods.push(method);
      return;
    }
    // A command that succeeds without merging, and without a queue.
    if (!this.mergeLands) return;
    await this.land(number, method);
  }
  /** Lands a pull request as GitHub would, for a merge queue or a person. */
  async land(number: number, method: KnowledgePublicationMergeMethod) {
    const found = this.pullRequests.find((pr) => pr.number === number)!;
    const clone = resolve(this.scratch, `merge-${number}`);
    await execute("git", ["clone", "--quiet", this.remote, clone]);
    if (method === "merge")
      await git(clone, [
        "merge",
        "--no-ff",
        "--quiet",
        "-m",
        `Merge pull request #${number}`,
        `origin/${found.head}`,
      ]);
    else if (method === "squash") {
      await git(clone, ["merge", "--squash", "--quiet", `origin/${found.head}`]);
      await git(clone, [
        "commit",
        "--quiet",
        "-m",
        `docs: publish reviewed background knowledge (#${number})`,
      ]);
    } else {
      // GitHub replays each commit with itself as committer, so the base gets new commits even
      // where a fast-forward was possible; the published SHAs never equal the head's.
      const forkPoint = await git(clone, ["merge-base", "HEAD", `origin/${found.head}`]);
      await git(clone, ["cherry-pick", `${forkPoint}..origin/${found.head}`], {
        ...developer,
        GIT_COMMITTER_NAME: "GitHub",
        GIT_COMMITTER_EMAIL: "noreply@github.com",
      });
      const landed = await git(clone, ["rev-list", `${forkPoint}..HEAD`]);
      const head = await git(clone, ["rev-list", `${forkPoint}..origin/${found.head}`]);
      if (landed.split("\n").some((sha) => head.split("\n").includes(sha)))
        throw new Error("FakeForge's rebase merge kept a head commit.");
    }
    await git(clone, ["push", "--quiet", "origin", `HEAD:refs/heads/${found.base}`]);
    found.headSha = await this.head(found.head);
    found.state = "merged";
    found.mergedAt = new Date().toISOString();
    this.touch(found);
    found.mergeCommit = this.mergeCommitReported ? await this.head(found.base) : null;
    this.queued.delete(number);
    this.merges++;
    this.mergeMethods.push(method);
  }
}

export async function setup(
  options: {
    merge?: "when_checks_pass" | "never";
    formatter?: KnowledgeOutputFormatter;
    scope?: "delegation";
    /** Files the developer commits on the remote base before the owner clones it. */
    seed?: Record<string, string>;
    checks?: { ignore: string[] };
  } = {},
) {
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
  for (const [path, content] of Object.entries(options.seed ?? {}))
    await commit(seed, path, content, developer, `chore: seed ${path}`);
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
        ...(options.scope === undefined ? {} : { scope: options.scope }),
        ...(options.checks === undefined ? {} : { checks: options.checks }),
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
  // The bare remote keeps a reflog, so tests can count every update of the publication branch.
  await git(remote, ["config", "core.logAllRefUpdates", "always"]);
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const store = {
    events: {
      get: (eventId: string) =>
        events.find((event) => (event as { eventId?: string }).eventId === eventId) ?? null,
      append: (event: { type: string; payload: Record<string, unknown> }) => events.push(event),
    },
    manifest: { projectId: "prj_knowledge_publication" },
    writableEventSchemaVersion: 4,
  } as unknown as KnowledgePublicationRepairEvents;
  const publish = (now?: () => Date) =>
    publishKnowledgeOutputs({
      repositoryRoot: root,
      forge,
      formatter: options.formatter ?? null,
      events: store,
      ...(now === undefined ? {} : { now }),
    });
  return { root, remote, forge, publish, owner, events };
}

export const remoteMain = (remote: string) => git(remote, ["rev-parse", "refs/heads/main"]);

/** An active delegation whose normalization roots reach outside `docs/`, as in production. */
export function publicationDelegation(): ConvergenceDelegation {
  const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
  const binding = {
    roleId: "developer",
    version: "1.0.0",
    contractHash: hash("1"),
    profileHash: hash("2"),
    capabilityHash: hash("3"),
  };
  const plan: Omit<ConvergenceDelegation, "review"> = {
    schemaVersion: 1,
    projectId: "prj_knowledge_publication",
    state: "active",
    parentAgentId: `agt_${"a".repeat(24)}`,
    parentRoleHash: hash("1"),
    roles: { generator: binding, reviewer: binding, writer: binding, integrator: binding },
    canonicalRoots: ["docs"],
    normalizationRoots: ["README.md", "AGENTS.md", ".agents/skills", "apps/site/README.md"],
    providers: ["codex"],
    verification: [{ suiteId: "repository.default.v1", suiteHash: hash("4") }],
    integrationTarget: {
      ref: "refs/heads/lervo/knowledge-integration",
      repositoryIdentityHash: hash("5"),
    },
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    resourceCeilings: {
      maximumStages: 4,
      maximumDocuments: 4,
      maximumSourceBytes: 65_536,
      maximumProviderCalls: 4,
    },
  };
  return {
    ...plan,
    review: {
      reviewerAgentId: `agt_${"b".repeat(24)}`,
      reviewedAt: new Date().toISOString(),
      planHash: convergenceDelegationPlanHash(plan),
    },
  };
}

/** Lands a developer commit on the remote base from another clone, moving `origin/main`. */
export async function advanceRemoteMain(remote: string, path: string, content: string) {
  const other = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-publication-other-"));
  directories.push(other);
  const clone = resolve(other, "clone");
  await execute("git", ["clone", "--quiet", remote, clone]);
  await commit(clone, path, content, developer, "docs: land other work");
  await git(clone, ["push", "--quiet", "origin", "main"]);
}

export const isAncestor = (root: string, ancestor: string, descendant: string) =>
  git(root, ["merge-base", "--is-ancestor", ancestor, descendant]).then(
    () => true,
    () => false,
  );
