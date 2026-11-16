import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  planSshConnectionReuse,
  prepareSshControlDirectory,
  resolveSshTransport,
  sshControlPath,
  sshTransportArguments,
} from "../src/repository-replica-ssh-connection.js";
import { SshRepositoryReplicaPeer } from "../src/repository-replica-ssh-peer.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const transport = {
  executable: "/usr/bin/ssh",
  arguments: ["-o", "BatchMode=yes"],
  destination: "peer",
};

describe("Lervo-managed SSH connection reuse (ADR-0570)", () => {
  it("multiplexes every peer step through one private control socket by default", () => {
    const controlPath = sshControlPath("/home/owner/.lervo/state/replica-ssh", transport);
    expect(controlPath).toBe("/home/owner/.lervo/state/replica-ssh/%C");
    const reuse = planSshConnectionReuse({ ...transport, platform: "darwin", controlPath });
    expect(reuse).toEqual({ mode: "managed", controlPath });
    expect(sshTransportArguments(transport.executable, transport.arguments, reuse)).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-o",
      "ControlMaster=auto",
      "-o",
      `ControlPath=${controlPath}`,
      "-o",
      "ControlPersist=600",
    ]);
  });

  it("adds nothing the configuration already sets, including its own multiplexing", () => {
    // The owner's live mitigation of 2026-11-16 keeps working unchanged.
    const configured = [
      "-o",
      "BatchMode=yes",
      "-o",
      "ControlMaster=auto",
      "-o",
      "ControlPath=~/.ssh/cm-lervo-replica-%C",
      "-o",
      "ControlPersist=600",
      "-o",
      "ServerAliveInterval=30",
      "-oServerAliveCountMax 3",
    ];
    const reuse = planSshConnectionReuse({
      ...transport,
      arguments: configured,
      platform: "darwin",
      controlPath: "/state/replica-ssh/%C",
    });
    expect(reuse).toEqual({ mode: "configured" });
    expect(sshTransportArguments(transport.executable, configured, reuse)).toEqual([
      ...configured,
      "-o",
      "ConnectTimeout=15",
    ]);
    for (const own of [
      ["-S", "/tmp/socket"],
      ["-S/tmp/socket"],
      ["-M"],
      ["-o", "controlpersist=no"],
    ])
      expect(
        planSshConnectionReuse({
          ...transport,
          arguments: own,
          platform: "linux",
          controlPath: "/s",
        }).mode,
      ).toBe("configured");
  });

  it("leaves other clients and Windows OpenSSH without multiplexing", () => {
    const other = planSshConnectionReuse({
      ...transport,
      executable: process.execPath,
      platform: "linux",
      controlPath: "/s/%C",
    });
    expect(other).toEqual({ mode: "unavailable", reason: "client_not_openssh" });
    expect(sshTransportArguments(process.execPath, ["script.mjs"], other)).toEqual(["script.mjs"]);
    const windows = planSshConnectionReuse({
      ...transport,
      executable: "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
      platform: "win32",
      controlPath: "C:/s/%C",
    });
    expect(windows).toEqual({ mode: "unavailable", reason: "platform_unsupported" });
  });

  it("fits the control socket into the platform's socket path limit", () => {
    // 60 characters leave no room for `%C` (40) and the master's temporary suffix (17).
    const long = `/${"d".repeat(59)}`;
    expect(sshControlPath(long, transport)).toMatch(new RegExp(`^${long}/[a-f0-9]{16}$`, "u"));
    expect(sshControlPath(`/${"d".repeat(80)}`, transport)).toBeNull();
    expect(sshControlPath("/Users/o/App Support/s", transport)).toBe('"/Users/o/App Support/s/%C"');
    expect(sshControlPath("/state/100%", transport)).toBe("/state/100%%/%C");
    expect(sshControlPath('/state/"quoted"', transport)).toBeNull();
    expect(planSshConnectionReuse({ ...transport, platform: "linux", controlPath: null })).toEqual({
      mode: "unavailable",
      reason: "control_path_unsupported",
    });
  });

  it("creates the control directory owner-only and refuses one others can enter", async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-ssh-control-"));
    roots.push(root);
    const directory = join(root, "replica-ssh");
    await expect(prepareSshControlDirectory(directory)).resolves.toBe(true);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    const shared = join(root, "shared");
    await mkdir(shared, { mode: 0o755 });
    await chmod(shared, 0o755);
    await expect(prepareSshControlDirectory(shared)).resolves.toBe(false);
    const resolved = await resolveSshTransport({
      ...transport,
      platform: "linux",
      controlDirectory: shared,
    });
    expect(resolved.reuse).toEqual({ mode: "unavailable", reason: "control_directory_unsafe" });
    expect(resolved.arguments.join(" ")).not.toContain("ControlMaster");
  });

  it("sends every peer step of a cycle through the same control socket", async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-ssh-reuse-"));
    roots.push(root);
    // A stand-in OpenSSH client named `ssh` that records its arguments and answers each step.
    const bin = join(root, "bin");
    await mkdir(bin);
    const log = join(root, "calls.jsonl");
    const ssh = join(bin, "ssh");
    await writeFile(
      ssh,
      `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const action = args[args.indexOf("repository-replica") + 1];
if (action === "capture-version")
  process.stdout.write(JSON.stringify({ schemaVersion: 1, captureVersion: "lervo.repository-replica.capture.v1" }) + "\\n");
`,
    );
    await chmod(ssh, 0o755);
    const resolved = await resolveSshTransport({
      executable: ssh,
      arguments: ["-o", "BatchMode=yes"],
      destination: "peer",
      platform: "linux",
      controlDirectory: join(root, "state", "replica-ssh"),
    });
    expect(resolved.reuse.mode).toBe("managed");
    const peer = new SshRepositoryReplicaPeer({
      executable: ssh,
      arguments: resolved.arguments,
      destination: "peer",
      remoteNodeExecutable: "node",
      remoteRuntimeExecutable: "runtime.js",
    });
    await peer.captureVersion();
    await peer.recordReceipt({
      schemaVersion: 1,
      replicaId: "fixture",
      repositoryRoot: "/peer/root",
      commonSnapshotHash: "sha256:x",
      localSnapshotHash: "sha256:x",
      peerSnapshotHash: "sha256:x",
      reconciledAt: "2026-11-16T00:00:00.000Z",
      status: "current",
    });
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(calls).toHaveLength(2);
    const controlPaths = calls.map((args) => args.find((arg) => arg.startsWith("ControlPath=")));
    expect(controlPaths[0]).toBe(`ControlPath=${join(root, "state", "replica-ssh", "%C")}`);
    expect(new Set(controlPaths).size).toBe(1);
    for (const args of calls)
      expect(args.indexOf("ControlMaster=auto")).toBeLessThan(args.indexOf("peer"));
  });
});
