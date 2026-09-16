import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { SshRepositoryReplicaPeer } from "../src/repository-replica-ssh-peer.js";

it.each([true, false])(
  "bounds subscription frames and disposes the remote process (valid=%s)",
  async (valid) => {
    const root = await mkdtemp(join(tmpdir(), "lervo-peer-hints-"));
    let stop: (() => void) | undefined;
    try {
      const script = join(root, "peer.mjs");
      await writeFile(
        script,
        `process.stdout.write(${JSON.stringify(valid ? '{"schemaVersion":1,"status":"changed"}\n' : "invalid\n")}); setInterval(() => {}, 10000);`,
      );
      const peer = new SshRepositoryReplicaPeer({
        executable: process.execPath,
        arguments: [script],
        destination: "fixture",
        remoteNodeExecutable: "node",
        remoteRuntimeExecutable: "runtime",
      });
      const changed = vi.fn();
      const failed = vi.fn();
      stop = peer.subscribe("/fixture", changed, failed);
      await vi.waitFor(() => expect(valid ? changed : failed).toHaveBeenCalledOnce());
      expect(valid ? failed : changed).not.toHaveBeenCalled();
      stop();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(failed).toHaveBeenCalledTimes(valid ? 0 : 1);
    } finally {
      stop?.();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("terminates a repository replica SSH command that exceeds its deadline", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-peer-timeout-"));
  try {
    const script = join(root, "peer.mjs");
    const pidFile = join(root, "pid");
    await writeFile(
      script,
      'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 10000);',
    );
    const peer = new SshRepositoryReplicaPeer({
      executable: process.execPath,
      arguments: [script, pidFile],
      destination: "fixture",
      remoteNodeExecutable: "node",
      remoteRuntimeExecutable: "runtime",
      commandTimeoutMs: 25,
    });
    await expect(peer.snapshot("/fixture")).rejects.toThrow(/execution deadline/u);
    const pid = Number(await readFile(pidFile, "utf8"));
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
