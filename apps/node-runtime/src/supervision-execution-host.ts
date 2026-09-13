import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { hostname, platform } from "node:os";
import { promisify } from "node:util";
import type { OperatingMandate } from "@lervo/application-contract";
import { assertOperatingMandate, operatingContractHash } from "@lervo/work-controller";

const execute = promisify(execFile);

async function machineIdentity(): Promise<string> {
  if (platform() === "linux") {
    const handle = await open("/etc/machine-id", constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > 128)
        throw new Error("The execution host identity source is unsafe.");
      const bytes = Buffer.alloc(129);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const value = bytes.subarray(0, bytesRead).toString("utf8").trim();
      const after = await handle.stat();
      if (
        !/^[a-f0-9]{32}$/u.test(value) ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new Error("The execution host identity source is invalid or changed.");
      return value;
    } finally {
      await handle.close();
    }
  }
  if (platform() === "darwin") {
    const { stdout } = await execute("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
      timeout: 5_000,
      maxBuffer: 16 * 1024,
    });
    const values = [...stdout.matchAll(/"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]{36})"/gu)];
    if (values.length !== 1) throw new Error("The execution host identity is unavailable.");
    return values[0]![1]!.toLowerCase();
  }
  throw new Error("The execution host identity adapter does not support this platform.");
}

/** Host configuration identity, not remote attestation. Raw identifiers stay in this adapter. */
export async function observeSupervisionHostIdentity() {
  const name = hostname().toLowerCase();
  const machine = await machineIdentity();
  if (hostname().toLowerCase() !== name)
    throw new Error("The execution host identity changed during observation.");
  return {
    schemaVersion: 1 as const,
    hostIdentityHash: operatingContractHash({
      contract: "lervo.execution-host.v1",
      platform: platform(),
      hostname: name,
      machineIdentity: machine,
    }),
  };
}

export async function observeMandateExecutionAuthority(input: {
  mandate: OperatingMandate;
  hubSyncEnabled: boolean;
}) {
  assertOperatingMandate(input.mandate);
  if (input.mandate.schemaVersion === 1) {
    if (input.hubSyncEnabled)
      throw new Error("Hub-connected supervision requires a reviewed designated execution host.");
    return { mode: "local_repository_v1" as const, hostIdentityHash: null };
  }
  const observed = await observeSupervisionHostIdentity();
  if (observed.hostIdentityHash !== input.mandate.executionAuthority.hostIdentityHash)
    throw new Error("This host is not the mandate's designated execution authority.");
  return { mode: "designated_host_v1" as const, hostIdentityHash: observed.hostIdentityHash };
}
