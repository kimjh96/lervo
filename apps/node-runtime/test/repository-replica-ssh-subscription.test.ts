import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
