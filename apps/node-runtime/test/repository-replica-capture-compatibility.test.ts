import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  LEGACY_REPOSITORY_REPLICA_CAPTURE_VERSION,
  REPOSITORY_REPLICA_CAPTURE_VERSION,
} from "../src/repository-replica-capture-version.js";
import { runRepositoryReplicaCli } from "../src/repository-replica-cli.js";
import { RepositoryReplicaCoordinator } from "../src/repository-replica-coordinator.js";
import { LocalRepositoryReplicaPeer } from "../src/repository-replica-local-peer.js";
import { SshRepositoryReplicaPeer } from "../src/repository-replica-ssh-peer.js";

const execute = promisify(execFile);
const roots: string[] = [];
const delegationPath = ".lervo/knowledge/convergence-delegation.json";

async function temporary(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    },
  });
  return stdout.trim();
}

/** A Mac and WSL checkout of a repository whose HEAD tracks the delegation, as plen does. */
async function trackedDelegationPair(): Promise<{ mac: string; wsl: string; state: string }> {
  const mac = await temporary("lervo-capture-mac-");
  await git(mac, "init", "-b", "main");
  await mkdir(join(mac, ".lervo/knowledge"), { recursive: true });
  await writeFile(
    join(mac, ".lervo/.gitignore"),
    "data/\nstate/\nknowledge/convergence-delegation.json\n",
  );
  await writeFile(join(mac, delegationPath), "committed-grant\n");
  await writeFile(join(mac, "source.ts"), "export const value = 1;\n");
  await git(mac, "add", "-A");
  await git(mac, "add", "-f", delegationPath);
  await git(mac, "commit", "--quiet", "-m", "fixture with a tracked delegation");
  const wsl = join(await temporary("lervo-capture-wsl-parent-"), "wsl");
  await execute("git", ["clone", "--quiet", mac, wsl]);
  return { mac, wsl, state: join(await temporary("lervo-capture-state-"), "replicas.json") };
}

/** A peer whose runtime reports the capture semantics of a bundle that predates ADR-0478. */
class LegacyRuntimePeer extends LocalRepositoryReplicaPeer {
  override captureVersion(): Promise<string> {
    return Promise.resolve(LEGACY_REPOSITORY_REPLICA_CAPTURE_VERSION);
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("replica capture compatibility (ADR-0483)", () => {
  it(
    "refuses a peer runtime with older capture semantics, then pulls a delegation-only change",
    { timeout: 60_000 },
    async () => {
      const { mac, wsl, state } = await trackedDelegationPair();
      const coordinator = (peer: LocalRepositoryReplicaPeer) =>
        new RepositoryReplicaCoordinator({
          stateFile: state,
          local: new LocalRepositoryReplicaPeer(),
          peer,
        });
      const reconcile = (peer: LocalRepositoryReplicaPeer) =>
        coordinator(peer).reconcile({ replicaId: "plen", localRoot: mac, peerRoot: wsl });
      await expect(reconcile(new LocalRepositoryReplicaPeer())).resolves.toMatchObject({
        status: "current",
      });
      const before = await readFile(state, "utf8");

      // The WSL owner renews; only the tracked delegation changes.
      await writeFile(join(wsl, delegationPath), "renewed-by-the-owner\n");
      await expect(reconcile(new LegacyRuntimePeer())).rejects.toMatchObject({
        failure: { code: "repository_replica_capture_incompatible", stage: "protocol" },
      });
      // Nothing was reported as current and the common base did not move.
      expect(JSON.parse(await readFile(state, "utf8")).replicas).toEqual(
        JSON.parse(before).replicas,
      );
      expect(await readFile(join(mac, delegationPath), "utf8")).toBe("committed-grant\n");

      // Once the peer runs the current runtime, the follower pulls the owner's exact bytes.
      await expect(reconcile(new LocalRepositoryReplicaPeer())).resolves.toMatchObject({
        status: "pulled",
      });
      expect(await readFile(join(mac, delegationPath), "utf8")).toBe("renewed-by-the-owner\n");
      await expect(reconcile(new LocalRepositoryReplicaPeer())).resolves.toMatchObject({
        status: "current",
      });
    },
  );

  it("reports this runtime's capture version through the peer command", async () => {
    const stdout: string[] = [];
    const status = await runRepositoryReplicaCli(["capture-version"], {
      cwd: tmpdir(),
      stdinBytes: async () => new Uint8Array(),
      stdout: (message) => stdout.push(message),
      stdoutBytes: () => undefined,
      stderr: () => undefined,
    });
    expect(status).toBe(0);
    expect(JSON.parse(stdout.join(""))).toEqual({
      schemaVersion: 1,
      captureVersion: REPOSITORY_REPLICA_CAPTURE_VERSION,
    });
  });

  it("reads the remote capture version, recognizes a legacy runtime, and keeps transport failures", async () => {
    const work = await temporary("lervo-capture-ssh-");
    const peer = async (body: string) => {
      const script = join(work, `peer-${Math.random().toString(36).slice(2)}.mjs`);
      await writeFile(script, body);
      return new SshRepositoryReplicaPeer({
        executable: process.execPath,
        arguments: [script],
        destination: "fixture",
        remoteNodeExecutable: "node",
        remoteRuntimeExecutable: "runtime",
      });
    };
    const current = await peer(
      `process.stdout.write(${JSON.stringify(
        `${JSON.stringify({ schemaVersion: 1, captureVersion: REPOSITORY_REPLICA_CAPTURE_VERSION })}\n`,
      )});\n`,
    );
    await expect(current.captureVersion()).resolves.toBe(REPOSITORY_REPLICA_CAPTURE_VERSION);

    // An older runtime throws its usage error uncaught; Node prints a long source line first.
    const legacy = await peer(
      `process.stderr.write("file:///runtime/dist/bin.js:1\\n" + "x".repeat(20000) + "\\n\\nError: Usage: lervo-node repository-replica <snapshot|bundle|apply|adopt|receipt|knowledge-supersession|reconcile|watch> ...\\n    at file:///runtime/dist/bin.js:1:1\\n"); process.exit(1);\n`,
    );
    await expect(legacy.captureVersion()).resolves.toBe(LEGACY_REPOSITORY_REPLICA_CAPTURE_VERSION);

    const unreachable = await peer(
      `process.stderr.write("ssh: connect to host fixture: Connection refused\\n"); process.exit(255);\n`,
    );
    await expect(unreachable.captureVersion()).rejects.toMatchObject({
      code: "repository_replica_transfer_failed",
    });
    const forged = await peer(
      `process.stdout.write(JSON.stringify({ schemaVersion: 1, captureVersion: "anything" }));\n`,
    );
    await expect(forged.captureVersion()).rejects.toMatchObject({
      code: "repository_replica_capture_version_invalid",
    });
  });
});
