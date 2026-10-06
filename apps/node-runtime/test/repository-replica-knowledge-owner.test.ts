import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { RepositoryReplicaCoordinator } from "../src/repository-replica-coordinator.js";
import { LocalRepositoryReplicaPeer } from "../src/repository-replica-local-peer.js";

const execute = promisify(execFile);
const roots: string[] = [];
const ownerHash = `sha256:${"2".repeat(64)}`;

async function git(root: string, args: string[], identity = "Developer"): Promise<string> {
  const email = identity === "Lervo Knowledge" ? "knowledge@lervo.invalid" : "dev@example.com";
  const { stdout } = await execute("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: identity,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: identity,
      GIT_COMMITTER_EMAIL: email,
    },
  });
  return stdout.trim();
}

/** The owner host's background commit, as `commitSettledKnowledgeOutputs` writes it. */
async function knowledgeCommit(root: string, path: string, content: string): Promise<void> {
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, path), content);
  await git(root, ["add", "--", path], "Lervo Knowledge");
  await git(
    root,
    [
      "commit",
      "--quiet",
      "-m",
      "docs: apply reviewed background knowledge",
      "-m",
      `Lervo-Convergence-Host: ${ownerHash}`,
    ],
    "Lervo Knowledge",
  );
}

async function hostLocalOwnerState(root: string, label: string): Promise<void> {
  await mkdir(join(root, ".lervo/state/knowledge"), { recursive: true });
  await mkdir(join(root, ".lervo/knowledge"), { recursive: true });
  await writeFile(
    join(root, ".lervo/state/knowledge/convergence-owner-host.json"),
    JSON.stringify({ hostLabel: label }),
  );
  await writeFile(
    join(root, ".lervo/state/knowledge/convergence-owner.json"),
    JSON.stringify({ role: label === "wsl" ? "owner" : "waiting_owner" }),
  );
  await writeFile(
    join(root, ".lervo/knowledge/convergence-delegation.json"),
    `{"host":"${label}"}`,
  );
}

async function replicas() {
  const mac = await mkdtemp(join(tmpdir(), "lervo-replica-knowledge-mac-"));
  roots.push(mac);
  await git(mac, ["init", "-b", "main"]);
  await mkdir(join(mac, ".lervo/knowledge"), { recursive: true });
  await writeFile(
    join(mac, ".lervo/.gitignore"),
    "data/\nstate/\nknowledge/convergence-delegation.json\n",
  );
  await writeFile(join(mac, ".lervo/project.yaml"), "schemaVersion: 1\n");
  await writeFile(join(mac, "source.ts"), "export const value = 1;\n");
  await git(mac, ["add", "."]);
  await git(mac, ["commit", "--quiet", "-m", "fixture"]);
  const wsl = await mkdtemp(join(tmpdir(), "lervo-replica-knowledge-wsl-"));
  await rm(wsl, { recursive: true, force: true });
  roots.push(wsl);
  await execute("git", ["clone", "--quiet", mac, wsl]);
  const state = await mkdtemp(join(tmpdir(), "lervo-replica-knowledge-state-"));
  roots.push(state);
  await hostLocalOwnerState(mac, "mac");
  await hostLocalOwnerState(wsl, "wsl");
  const coordinator = new RepositoryReplicaCoordinator({
    stateFile: join(state, "replicas.json"),
    local: new LocalRepositoryReplicaPeer(),
    peer: new LocalRepositoryReplicaPeer(),
  });
  const reconcile = () =>
    coordinator.reconcile({ replicaId: "lervo", localRoot: mac, peerRoot: wsl });
  return { mac, wsl, reconcile };
}

const knowledgeCommits = async (root: string) =>
  (
    await git(root, [
      "log",
      "--author=knowledge@lervo.invalid",
      "--format=%H %(trailers:key=Lervo-Convergence-Host,valueonly,separator=%x2C)",
    ])
  )
    .split("\n")
    .filter((line) => line.trim() !== "");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("a convergence delegation that HEAD tracks (ADR-0478)", () => {
  const delegationPath = ".lervo/knowledge/convergence-delegation.json";

  it(
    "converges both checkouts on the owner's renewal and keeps it through later changes",
    { timeout: 60_000 },
    async () => {
      const { mac, wsl, reconcile } = await replicas();
      // A repository whose HEAD predates the ignore rule tracks the reviewed grant.
      for (const root of [mac, wsl]) await writeFile(join(root, delegationPath), "reviewed\n");
      await git(wsl, ["add", "-f", delegationPath]);
      await git(wsl, ["commit", "--quiet", "-m", "chore: track the reviewed grant"]);
      await expect(reconcile()).resolves.toMatchObject({ status: "pulled" });

      // Only the owner renews; the follower receives the exact bytes.
      await writeFile(join(wsl, delegationPath), "renewed by the owner\n");
      await expect(reconcile()).resolves.toMatchObject({ status: "pulled" });
      expect(await readFile(join(mac, delegationPath), "utf8")).toBe("renewed by the owner\n");

      // An upgrade on the owner and an edit on the follower must not restore HEAD's grant.
      await writeFile(join(wsl, "upgraded.ts"), "export const upgraded = true;\n");
      await writeFile(join(mac, "source.ts"), "export const value = 3;\n");
      await expect(reconcile()).resolves.toMatchObject({ status: "merged" });
      for (const root of [mac, wsl])
        expect(await readFile(join(root, delegationPath), "utf8")).toBe("renewed by the owner\n");
      await expect(reconcile()).resolves.toMatchObject({ status: "current" });
    },
  );
});

describe("repository replica with a single knowledge convergence owner", () => {
  it(
    "starts current despite different host-local owner state on each side",
    { timeout: 60_000 },
    async () => {
      const { reconcile } = await replicas();
      await expect(reconcile()).resolves.toMatchObject({ status: "current" });
    },
  );

  it(
    "moves the owner's knowledge commits to the other host and converges one history",
    { timeout: 60_000 },
    async () => {
      const { mac, wsl, reconcile } = await replicas();
      await reconcile();

      // Only the WSL owner commits knowledge outputs; the Mac pulls them unchanged.
      await knowledgeCommit(wsl, "docs/runtime.md", "# Runtime\n\nOwner output one.\n");
      await expect(reconcile()).resolves.toMatchObject({ status: "pulled" });
      expect(await git(mac, ["rev-parse", "HEAD"])).toBe(await git(wsl, ["rev-parse", "HEAD"]));

      // A developer commit on the Mac and a second owner commit on WSL merge without conflict.
      await writeFile(join(mac, "source.ts"), "export const value = 2;\n");
      await git(mac, ["commit", "--quiet", "-am", "feat: change value"]);
      await knowledgeCommit(wsl, "docs/owner.md", "# Owner\n\nOwner output two.\n");
      await expect(reconcile()).resolves.toMatchObject({ status: "merged" });
      expect(await git(mac, ["rev-parse", "HEAD"])).toBe(await git(wsl, ["rev-parse", "HEAD"]));

      const [macKnowledge, wslKnowledge] = [
        await knowledgeCommits(mac),
        await knowledgeCommits(wsl),
      ];
      expect(macKnowledge).toEqual(wslKnowledge);
      expect(macKnowledge).toHaveLength(2);
      expect(macKnowledge.every((line) => line.endsWith(ownerHash))).toBe(true);
      expect(await readFile(join(mac, "docs/owner.md"), "utf8")).toContain("Owner output two");

      // Host-local identity, fence, and delegation never cross hosts.
      expect(
        await readFile(join(mac, ".lervo/state/knowledge/convergence-owner-host.json"), "utf8"),
      ).toContain("mac");
      expect(
        await readFile(join(wsl, ".lervo/knowledge/convergence-delegation.json"), "utf8"),
      ).toContain("wsl");
      await expect(reconcile()).resolves.toMatchObject({ status: "current" });
    },
  );
});
