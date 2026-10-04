import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { runRepositoryReplicaCli } from "../src/repository-replica-cli.js";
import {
  describeRepositoryReplicaFailure,
  parseRepositoryReplicaPeerFailure,
  RepositoryReplicaPeerError,
} from "../src/repository-replica-failure.js";
import { captureRepositoryReplicaSnapshot } from "../src/repository-replica-git.js";
import { SshRepositoryReplicaPeer } from "../src/repository-replica-ssh-peer.js";

const execute = promisify(execFile);
const roots: string[] = [];

async function temporary(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function git(root: string, ...args: string[]): Promise<string> {
  return (
    await execute("git", ["-C", root, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.com",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.com",
      },
    })
  ).stdout.trim();
}

function ports(cwd: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    value: {
      cwd,
      stdinBytes: async () => new Uint8Array(),
      stdout: (message: string) => stdout.push(message),
      stdoutBytes: () => undefined,
      stderr: (message: string) => stderr.push(message),
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository replica error fidelity", () => {
  it("shows an injected Git failure's exit code and stderr digest in the CLI log and receipt", async () => {
    // An unborn repository makes `git rev-parse HEAD` fail with real Git stderr.
    const local = await temporary("lervo-replica-unborn-");
    await git(local, "init", "-b", "main");
    const work = await temporary("lervo-replica-config-");
    const peerScript = join(work, "peer.mjs");
    await writeFile(peerScript, "setTimeout(() => process.exit(1), 2_000);\n");
    const config = join(work, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 1,
        stateFile: join(work, "state.json"),
        pollIntervalMs: 1_000,
        peer: {
          executable: process.execPath,
          arguments: [peerScript],
          destination: "fixture",
          remoteNodeExecutable: "node",
          remoteRuntimeExecutable: "runtime",
        },
        repositories: [{ replicaId: "project", localRoot: local, peerRoot: "/peer/project" }],
      }),
      { mode: 0o600 },
    );
    await chmod(config, 0o600);
    const output = ports(work);

    await expect(
      runRepositoryReplicaCli(["reconcile", "--config", config], output.value),
    ).resolves.toBe(2);

    const log = output.stderr.join("");
    expect(log).toContain("repository_replica_snapshot_failed at snapshot");
    expect(log).toContain("git exit 128");
    expect(log).toMatch(/stderr: fatal: [^\n]*HEAD/u);
    const receipt = JSON.parse(
      await readFile(join(local, ".lervo/state/repository-replica.json"), "utf8"),
    ) as { status: string; lastFailure: Record<string, unknown> };
    expect(receipt.status).toBe("attention");
    expect(receipt.lastFailure).toMatchObject({
      code: "repository_replica_snapshot_failed",
      stage: "snapshot",
      gitExitCode: 128,
    });
    expect(receipt.lastFailure.stderrDigest).toMatch(/^fatal: .*HEAD/u);
    const health = JSON.parse(await readFile(join(work, "state.health.json"), "utf8")) as {
      status: string;
    };
    expect(health.status).toBe("degraded");
  }, 20_000);

  it("carries a peer command's structured Git failure across the SSH transport", async () => {
    const unborn = await temporary("lervo-replica-peer-unborn-");
    await git(unborn, "init", "-b", "main");
    const output = ports(unborn);

    await expect(
      runRepositoryReplicaCli(["snapshot", "--root", unborn], output.value),
    ).resolves.toBe(1);
    const reported = parseRepositoryReplicaPeerFailure(output.stderr.join(""));
    expect(reported).toMatchObject({
      code: "repository_replica_snapshot_failed",
      stage: "snapshot",
      gitExitCode: 128,
    });

    const work = await temporary("lervo-replica-peer-script-");
    const script = join(work, "peer.mjs");
    await writeFile(
      script,
      `process.stderr.write(${JSON.stringify(output.stderr.join(""))}); process.exit(1);\n`,
    );
    const peer = new SshRepositoryReplicaPeer({
      executable: process.execPath,
      arguments: [script],
      destination: "fixture",
      remoteNodeExecutable: "node",
      remoteRuntimeExecutable: "runtime",
    });
    const error = await peer.snapshot("/peer/project").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RepositoryReplicaPeerError);
    const failure = describeRepositoryReplicaFailure(error, "transfer");
    expect(failure).toMatchObject({ stage: "snapshot", gitExitCode: 128 });
    expect(failure.stderrDigest).toBe(reported!.stderrDigest);
  }, 20_000);

  it("reports an unstructured SSH failure as a redacted transfer failure", async () => {
    const work = await temporary("lervo-replica-ssh-failure-");
    const script = join(work, "peer.mjs");
    await writeFile(
      script,
      'process.stderr.write("ssh: connect to host example port 22: Connection refused password=hunter2\\n"); process.exit(255);\n',
    );
    const peer = new SshRepositoryReplicaPeer({
      executable: process.execPath,
      arguments: [script],
      destination: "fixture",
      remoteNodeExecutable: "node",
      remoteRuntimeExecutable: "runtime",
    });
    const failure = describeRepositoryReplicaFailure(
      await peer.snapshot("/peer/project").catch((caught: unknown) => caught),
      "snapshot",
    );
    expect(failure).toMatchObject({
      code: "repository_replica_transfer_failed",
      stage: "transfer",
      gitExitCode: null,
    });
    expect(failure.stderrDigest).toContain("Connection refused");
    expect(failure.stderrDigest).not.toContain("hunter2");
  });
});

describe("repository replica host-local exclusion", () => {
  it("excludes host-local files even when HEAD has no ignore rule for them", async () => {
    const root = await temporary("lervo-replica-host-local-");
    await git(root, "init", "-b", "main");
    await mkdir(join(root, ".lervo/state"), { recursive: true });
    await writeFile(join(root, "tracked.ts"), "export const tracked = true;\n");
    await writeFile(join(root, ".lervo/state/tracked-state.json"), "{}\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "fixture without a .lervo ignore rule");
    const head = await captureRepositoryReplicaSnapshot(root);

    await mkdir(join(root, ".lervo/knowledge"), { recursive: true });
    await mkdir(join(root, ".lervo/data"), { recursive: true });
    await writeFile(join(root, ".lervo/knowledge/convergence-delegation.json"), "host grant\n");
    await writeFile(join(root, ".lervo/data/events.sqlite"), "host data\n");
    await writeFile(join(root, ".lervo/state/repository-replica.json"), "{}\n");
    await writeFile(join(root, ".lervo/state/tracked-state.json"), '{"changed":true}\n');
    expect((await captureRepositoryReplicaSnapshot(root)).snapshotHash).toBe(head.snapshotHash);

    await writeFile(join(root, ".lervo/knowledge/index.yaml"), "replicated: true\n");
    const snapshot = await captureRepositoryReplicaSnapshot(root);
    const paths = (await git(root, "ls-tree", "-r", "--name-only", snapshot.worktreeTree)).split(
      "\n",
    );
    expect(paths).toContain(".lervo/knowledge/index.yaml");
    expect(paths).toContain(".lervo/state/tracked-state.json");
    expect(paths).not.toContain(".lervo/knowledge/convergence-delegation.json");
    expect(paths).not.toContain(".lervo/data/events.sqlite");
    expect(paths).not.toContain(".lervo/state/repository-replica.json");
    expect(
      await git(root, "show", `${snapshot.worktreeTree}:.lervo/state/tracked-state.json`),
    ).toBe("{}");
  }, 20_000);
});
