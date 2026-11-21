import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  publishKnowledgeOutputs,
  readKnowledgeSupersessionLedger,
  type KnowledgePublicationForge,
} from "@lervo/repository-knowledge-runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  RepositoryReplicaCoordinator,
  RepositoryReplicaCycleError,
} from "../src/repository-replica-coordinator.js";
import { runRepositoryReplicaCli } from "../src/repository-replica-cli.js";
import { LocalRepositoryReplicaPeer } from "../src/repository-replica-local-peer.js";
import { SshRepositoryReplicaPeer } from "../src/repository-replica-ssh-peer.js";

const execute = promisify(execFile);
const roots: string[] = [];

const DEVELOPER = { name: "Developer", email: "dev@example.com" };
const KNOWLEDGE = { name: "Lervo Knowledge", email: "knowledge@lervo.invalid" };

async function run(root: string, args: string[], identity = DEVELOPER): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    },
  });
  return stdout.trim();
}

async function commit(root: string, path: string, content: string, identity = DEVELOPER) {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
  await run(root, ["add", "--", path], identity);
  await run(root, ["commit", "--quiet", "-m", `docs: write ${path}`], identity);
  return run(root, ["rev-parse", "HEAD"]);
}

/** WSL is the standalone convergence owner and publishes to the shared remote. */
async function configureOwner(root: string): Promise<void> {
  await mkdir(join(root, ".lervo/state/knowledge"), { recursive: true });
  await writeFile(
    join(root, ".lervo/state/knowledge/convergence-owner-host.json"),
    JSON.stringify({
      schemaVersion: 1,
      hostId: `hst_${"2".repeat(32)}`,
      hostLabel: "wsl",
      coordination: { mode: "standalone" },
      publication: {
        remote: "origin",
        baseBranch: "main",
        branch: "lervo/knowledge-outputs",
        merge: "when_checks_pass",
      },
    }),
  );
  await writeFile(
    join(root, ".lervo/state/knowledge/convergence-owner.json"),
    JSON.stringify({
      schemaVersion: 1,
      recordedHolderKey: null,
      verdict: {
        role: "owner",
        reason: "standalone_owner",
        mode: "standalone",
        hostHash: `sha256:${"2".repeat(64)}`,
        hostLabel: "wsl",
        holder: null,
        validUntil: new Date(Date.now() + 3_600_000).toISOString(),
        wakeAt: null,
        grantedAt: null,
        yieldUntil: null,
        observedAt: new Date().toISOString(),
      },
    }),
  );
}

/** No pull request exists: the replay conflicts before anything is pushed. */
const forge: KnowledgePublicationForge = {
  findPullRequest: async () => null,
  createPullRequest: () => Promise.reject(new Error("unexpected create")),
  updatePullRequest: () => Promise.reject(new Error("unexpected update")),
  viewPullRequest: () => Promise.reject(new Error("unexpected view")),
  closePullRequest: () => Promise.reject(new Error("unexpected close")),
  checks: () => Promise.reject(new Error("unexpected checks")),
  rerunFailedChecks: () => Promise.reject(new Error("unexpected rerun")),
  merge: () => Promise.reject(new Error("unexpected merge")),
  // ADR-0603: nothing published yet, and a policy that allows a merge commit.
  publicationHistory: async () => [],
  policy: async () => ({
    mergeMethods: ["merge"],
    excluded: [],
    requiredChecks: [],
    strict: false,
    reviewRequired: false,
    mergeQueue: false,
    baseRefusals: [],
    branchRefusals: [],
  }),
  gate: () => Promise.reject(new Error("unexpected gate")),
  closureCause: () => Promise.reject(new Error("unexpected closure")),
  repository: async () => "example/repository",
};

async function hosts() {
  const directory = await mkdtemp(join(tmpdir(), "lervo-replica-supersession-"));
  roots.push(directory);
  const remote = join(directory, "remote.git");
  await execute("git", ["init", "--quiet", "--bare", "-b", "main", remote]);
  const seed = join(directory, "seed");
  await execute("git", ["clone", "--quiet", remote, seed]);
  await run(seed, ["checkout", "--quiet", "-b", "main"]);
  await writeFile(join(seed, ".gitignore"), ".lervo/state/\n");
  await writeFile(join(seed, "source.ts"), "export const value = 1;\n");
  await run(seed, ["add", "."]);
  await commit(seed, "docs/runtime.md", "# Runtime\n");
  await run(seed, ["push", "--quiet", "origin", "main"]);
  const mac = join(directory, "mac");
  const wsl = join(directory, "wsl");
  await execute("git", ["clone", "--quiet", remote, mac]);
  await execute("git", ["clone", "--quiet", remote, wsl]);
  await configureOwner(wsl);
  const coordinator = new RepositoryReplicaCoordinator({
    stateFile: join(directory, "replicas.json"),
    local: new LocalRepositoryReplicaPeer(),
    peer: new LocalRepositoryReplicaPeer(),
  });
  const reconcile = () =>
    coordinator.reconcile({ replicaId: "lervo", localRoot: mac, peerRoot: wsl });
  /** Another host's outputs for the same document merge into the remote base first. */
  const advanceRemote = async () => {
    await run(seed, ["pull", "--quiet", "origin", "main"]);
    await commit(seed, "docs/runtime.md", "# Runtime\n\nCurrent output.\n");
    await run(seed, ["push", "--quiet", "origin", "main"]);
    return run(seed, ["rev-parse", "HEAD"]);
  };
  const publish = () => publishKnowledgeOutputs({ repositoryRoot: wsl, forge, formatter: null });
  return { mac, wsl, reconcile, advanceRemote, publish };
}

/** The owner's two stale outputs reach the Mac through the replica, then lose a replay. */
async function supersededOnOwner(context: Awaited<ReturnType<typeof hosts>>) {
  const { mac, wsl, reconcile, advanceRemote } = context;
  await expect(reconcile()).resolves.toMatchObject({ status: "current" });
  const first = await commit(wsl, "docs/runtime.md", "# Runtime\n\nStale one.\n", KNOWLEDGE);
  const second = await commit(wsl, "docs/owner.md", "# Owner\n\nStale two.\n", KNOWLEDGE);
  await expect(reconcile()).resolves.toMatchObject({ status: "pulled" });
  expect(await run(mac, ["rev-parse", "HEAD"])).toBe(second);
  const remoteBase = await advanceRemote();
  return { stale: [first, second], remoteBase };
}

const reachable = (root: string, commit: string) =>
  run(root, ["merge-base", "--is-ancestor", commit, "HEAD"]).then(
    () => true,
    () => false,
  );

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("knowledge supersession across repository replicas", () => {
  it(
    "drops the owner's superseded commits on both hosts and never brings them back",
    { timeout: 120_000 },
    async () => {
      const context = await hosts();
      const { mac, wsl, reconcile, publish } = context;
      const { stale, remoteBase } = await supersededOnOwner(context);
      // The Mac changes too, so the cycle merges instead of pulling the owner's reset.
      await writeFile(join(mac, "source.ts"), "export const value = 2;\n");

      expect(await publish()).toMatchObject({
        state: { status: "superseded", failure: { code: "knowledge_publication_superseded" } },
      });
      expect(await run(wsl, ["rev-parse", "HEAD"])).toBe(remoteBase);
      const ledger = await readKnowledgeSupersessionLedger(wsl);
      expect(ledger.entries.map((entry) => entry.commit).sort()).toEqual([...stale].sort());
      expect(ledger.entries.every((entry) => /^[0-9a-f]{40}$/u.test(entry.patchId))).toBe(true);

      await expect(reconcile()).resolves.toMatchObject({ status: "merged" });
      for (const root of [mac, wsl]) {
        expect(await run(root, ["rev-parse", "HEAD"])).toBe(remoteBase);
        for (const commit of stale) expect(await reachable(root, commit)).toBe(false);
        expect(await readFile(join(root, "source.ts"), "utf8")).toBe("export const value = 2;\n");
      }
      const macLedger = await readKnowledgeSupersessionLedger(mac);
      expect(macLedger.entries).toEqual(ledger.entries);
      expect(macLedger.lastDrop).toMatchObject({ commitCount: 2 });
      expect(await run(mac, ["rev-parse", macLedger.lastDrop!.backupRef])).toBe(stale[1]);

      // Idempotent: later cycles and publications neither drop nor resurrect anything.
      await expect(reconcile()).resolves.toMatchObject({ status: "current" });
      await expect(reconcile()).resolves.toMatchObject({ status: "current" });
      expect(await readKnowledgeSupersessionLedger(mac)).toEqual(macLedger);
      expect(await publish()).toEqual({ status: "unchanged" });
      for (const root of [mac, wsl])
        expect(await run(root, ["rev-parse", "HEAD"])).toBe(remoteBase);
    },
  );

  it(
    "pulls the owner's reset when the other host did not change",
    { timeout: 120_000 },
    async () => {
      const context = await hosts();
      const { mac, wsl, reconcile, publish } = context;
      const { stale, remoteBase } = await supersededOnOwner(context);
      await publish();

      await expect(reconcile()).resolves.toMatchObject({ status: "pulled" });
      for (const root of [mac, wsl]) {
        expect(await run(root, ["rev-parse", "HEAD"])).toBe(remoteBase);
        for (const commit of stale) expect(await reachable(root, commit)).toBe(false);
      }
      await expect(reconcile()).resolves.toMatchObject({ status: "current" });
    },
  );

  it(
    "treats the owner's rewind to an ancestor as newer instead of re-merging the dropped commits",
    { timeout: 120_000 },
    async () => {
      const context = await hosts();
      const { mac, wsl, reconcile } = context;
      await reconcile();
      const base = await run(wsl, ["rev-parse", "HEAD"]);
      const stale = await commit(wsl, "docs/owner.md", "# Owner\n\nStale.\n", KNOWLEDGE);
      await reconcile();
      // The owner superseded the commit and moved back to the base it was built on.
      await mkdir(join(wsl, ".lervo/state/knowledge"), { recursive: true });
      await writeFile(
        join(wsl, ".lervo/state/knowledge/knowledge-supersession.json"),
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            { commit: stale, patchId: "f".repeat(40), base, supersededAt: "2026-10-05T00:00:00Z" },
          ],
          held: null,
          lastDrop: null,
        }),
      );
      await run(wsl, ["reset", "--keep", "--quiet", base]);
      await writeFile(join(mac, "source.ts"), "export const value = 3;\n");

      // Without the shared ledger the merge keeps the Mac's descendant head and pushes it back.
      await expect(reconcile()).resolves.toMatchObject({ status: "merged" });
      for (const root of [mac, wsl]) {
        expect(await run(root, ["rev-parse", "HEAD"])).toBe(base);
        expect(await reachable(root, stale)).toBe(false);
      }
      await expect(reconcile()).resolves.toMatchObject({ status: "current" });
    },
  );

  it(
    "keeps a developer commit above superseded commits, holds replication, and reports attention",
    { timeout: 120_000 },
    async () => {
      const context = await hosts();
      const { mac, wsl, reconcile, publish } = context;
      const { stale, remoteBase } = await supersededOnOwner(context);
      const developerCommit = await commit(mac, "src/feature.ts", "export const feature = 1;\n");
      await publish();

      const failure = await reconcile().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(RepositoryReplicaCycleError);
      expect(failure).toMatchObject({
        code: "repository_replica_superseded_knowledge_held",
        failure: { stage: "supersession" },
      });
      expect(await run(mac, ["rev-parse", "HEAD"])).toBe(developerCommit);
      expect(await run(wsl, ["rev-parse", "HEAD"])).toBe(remoteBase);
      const held = (await readKnowledgeSupersessionLedger(mac)).held;
      expect(held).toMatchObject({ reason: "under_other_work", commitCount: 2 });

      // A repeated cycle changes nothing and keeps the first observation.
      await expect(reconcile()).rejects.toMatchObject({
        code: "repository_replica_superseded_knowledge_held",
      });
      expect((await readKnowledgeSupersessionLedger(mac)).held).toEqual(held);
      expect(await run(mac, ["rev-parse", "HEAD"])).toBe(developerCommit);
      for (const commit of stale) expect(await reachable(wsl, commit)).toBe(false);
    },
  );

  it(
    "exchanges the ledger through the peer command and rejects an invalid peer report",
    { timeout: 60_000 },
    async () => {
      const context = await hosts();
      const { mac, wsl, publish } = context;
      const { stale } = await supersededOnOwner(context);
      await publish();
      const stdout: string[] = [];
      const ledger = await readKnowledgeSupersessionLedger(wsl);
      const status = await runRepositoryReplicaCli(["knowledge-supersession", "--root", mac], {
        cwd: mac,
        stdinBytes: async () => Buffer.from(JSON.stringify({ entries: ledger.entries })),
        stdout: (message) => stdout.push(message),
        stdoutBytes: () => undefined,
        stderr: () => undefined,
      });
      expect(status).toBe(0);
      const report = JSON.parse(stdout.join("")) as unknown;
      expect(report).toMatchObject({ dropped: { commitCount: 2 }, held: null });
      for (const commit of stale) expect(await reachable(mac, commit)).toBe(false);

      let scripts = 0;
      /** An SSH peer whose remote command prints `output` after reading its request. */
      const peer = (output: unknown) => {
        const script = join(mac, "..", `peer-${++scripts}.mjs`);
        return writeFile(
          script,
          `process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(${JSON.stringify(JSON.stringify(output))}));\n`,
        ).then(
          () =>
            new SshRepositoryReplicaPeer({
              executable: process.execPath,
              arguments: [script],
              destination: "fixture",
              remoteNodeExecutable: "node",
              remoteRuntimeExecutable: "runtime",
            }),
        );
      };
      await expect(
        (await peer(report)).reconcileKnowledgeSupersession({ repositoryRoot: wsl, entries: [] }),
      ).resolves.toEqual(report);
      await expect(
        (
          await peer({ ...(report as object), held: { reason: "unknown", commits: [] } })
        ).reconcileKnowledgeSupersession({ repositoryRoot: wsl, entries: [] }),
      ).rejects.toMatchObject({
        code: "repository_replica_supersession_invalid",
        stage: "supersession",
      });
    },
  );
});
