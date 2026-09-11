import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { readOwnerOnlyText } from "@lervo/runtime-security";

import {
  LocalRepositoryReplicaPeer,
  RepositoryReplicaCoordinator,
  type RepositoryReplicaReceipt,
} from "./repository-replica-coordinator.js";
import {
  applyRepositoryReplicaBundle,
  captureRepositoryReplicaSnapshot,
  createRepositoryReplicaBundle,
} from "./repository-replica-git.js";
import { SshRepositoryReplicaPeer } from "./repository-replica-ssh-peer.js";

export interface RepositoryReplicaCliPorts {
  cwd: string;
  stdinBytes(): Promise<Uint8Array>;
  stdout(message: string): void;
  stdoutBytes(bytes: Uint8Array): void;
  stderr(message: string): void;
  signal?: AbortSignal;
}

interface CoordinatorConfig {
  schemaVersion: 1;
  stateFile: string;
  pollIntervalMs: number;
  peer: {
    executable: string;
    arguments: string[];
    destination: string;
    remoteNodeExecutable: string;
    remoteRuntimeExecutable: string;
    remoteCommandPrefix?: string[];
  };
  repositories: Array<{ replicaId: string; localRoot: string; peerRoot: string }>;
}

const MAXIMUM_REPOSITORY_REPLICA_BUNDLE_BYTES = 512 * 1024 * 1024;

function oneOption(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  if (
    index < 0 ||
    args[index + 1] === undefined ||
    args.filter((item) => item === name).length !== 1
  ) {
    throw new Error(`Repository replica ${name} is required exactly once.`);
  }
  return args[index + 1]!;
}

async function readBundleInput(
  args: readonly string[],
  ports: RepositoryReplicaCliPorts,
): Promise<Uint8Array> {
  const optionIndex = args.indexOf("--bundle-file");
  if (optionIndex < 0) return ports.stdinBytes();
  const path = args[optionIndex + 1];
  if (path === undefined || args.filter((item) => item === "--bundle-file").length !== 1) {
    throw new Error("Repository replica --bundle-file is required exactly once when present.");
  }
  const resolved = resolve(ports.cwd, path);
  const metadata = await stat(resolved);
  if (!metadata.isFile() || metadata.size > MAXIMUM_REPOSITORY_REPLICA_BUNDLE_BYTES) {
    throw new Error("The repository replica bundle file is invalid or exceeds its bound.");
  }
  return new Uint8Array(await readFile(resolved));
}

async function readCoordinatorConfig(path: string): Promise<CoordinatorConfig> {
  const value = JSON.parse(await readOwnerOnlyText(path, 1024 * 1024)) as CoordinatorConfig;
  if (
    value.schemaVersion !== 1 ||
    typeof value.stateFile !== "string" ||
    !Number.isSafeInteger(value.pollIntervalMs) ||
    value.pollIntervalMs < 1_000 ||
    value.pollIntervalMs > 60_000 ||
    typeof value.peer !== "object" ||
    value.peer === null ||
    typeof value.peer.executable !== "string" ||
    !Array.isArray(value.peer.arguments) ||
    value.peer.arguments.some((item) => typeof item !== "string") ||
    typeof value.peer.destination !== "string" ||
    typeof value.peer.remoteNodeExecutable !== "string" ||
    typeof value.peer.remoteRuntimeExecutable !== "string" ||
    (value.peer.remoteCommandPrefix !== undefined &&
      (!Array.isArray(value.peer.remoteCommandPrefix) ||
        value.peer.remoteCommandPrefix.some((item) => typeof item !== "string"))) ||
    !Array.isArray(value.repositories) ||
    value.repositories.length < 1 ||
    value.repositories.length > 64 ||
    value.repositories.some(
      (item) =>
        typeof item.replicaId !== "string" ||
        typeof item.localRoot !== "string" ||
        typeof item.peerRoot !== "string",
    )
  ) {
    throw new Error("The repository replica coordinator configuration is invalid.");
  }
  return value;
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return;
  await new Promise<void>((resolveWait) => {
    const timer = setTimeout(resolveWait, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolveWait();
      },
      { once: true },
    );
  });
}

async function runCoordinator(
  config: CoordinatorConfig,
  ports: RepositoryReplicaCliPorts,
  watch: boolean,
): Promise<number> {
  const local = new LocalRepositoryReplicaPeer();
  const peer = new SshRepositoryReplicaPeer(config.peer);
  const coordinator = new RepositoryReplicaCoordinator({
    stateFile: resolve(ports.cwd, config.stateFile),
    local,
    peer,
  });
  let failed = false;
  while (true) {
    for (const repository of config.repositories) {
      try {
        const result = await coordinator.reconcile({
          replicaId: repository.replicaId,
          localRoot: resolve(ports.cwd, repository.localRoot),
          peerRoot: repository.peerRoot,
        });
        if (result.status === "divergent") {
          failed = true;
          ports.stderr(
            `Repository replica ${result.replicaId} is divergent (${result.localHash} != ${result.peerHash}; common ${result.commonHash ?? "none"}).\n`,
          );
        } else if (result.status !== "current") {
          ports.stdout(
            `Repository replica ${result.replicaId} ${result.status} at ${result.snapshotHash}.\n`,
          );
        }
      } catch (error) {
        failed = true;
        ports.stderr(
          `Repository replica ${repository.replicaId} failed: ${error instanceof Error ? error.message : "unknown failure"}.\n`,
        );
      }
    }
    if (!watch || ports.signal?.aborted === true) break;
    await wait(config.pollIntervalMs, ports.signal);
  }
  return failed && !watch ? 2 : 0;
}

export async function runRepositoryReplicaCli(
  args: readonly string[],
  ports: RepositoryReplicaCliPorts,
): Promise<number> {
  const action = args[0];
  if (["snapshot", "bundle", "apply", "adopt", "receipt"].includes(action ?? "")) {
    const root = resolve(ports.cwd, oneOption(args, "--root"));
    if (action === "snapshot") {
      ports.stdout(`${JSON.stringify(await captureRepositoryReplicaSnapshot(root))}\n`);
      return 0;
    }
    if (action === "bundle") {
      ports.stdoutBytes(await createRepositoryReplicaBundle(root));
      return 0;
    }
    if (action === "apply" || action === "adopt") {
      const applied = await applyRepositoryReplicaBundle({
        repositoryRoot: root,
        bundle: await readBundleInput(args, ports),
        expectedCurrentSnapshotHash: oneOption(args, "--expected"),
        ...(action === "adopt" ? { allowHistoryReplacement: true } : {}),
      });
      ports.stdout(`${JSON.stringify(applied)}\n`);
      return 0;
    }
    const receipt = JSON.parse(
      Buffer.from(await ports.stdinBytes()).toString("utf8"),
    ) as RepositoryReplicaReceipt;
    if (receipt.repositoryRoot !== root) throw new Error("The replica receipt root differs.");
    await new LocalRepositoryReplicaPeer().recordReceipt(receipt);
    return 0;
  }
  if (action === "reconcile") {
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: {
        config: { type: "string" },
        watch: { type: "boolean" },
      },
    });
    if (parsed.values.config === undefined)
      throw new Error("Repository replica config is required.");
    const config = await readCoordinatorConfig(resolve(ports.cwd, parsed.values.config));
    return runCoordinator(config, ports, parsed.values.watch === true);
  }
  throw new Error(
    "Usage: lervo-node repository-replica <snapshot|bundle|apply|adopt|receipt|reconcile> ...",
  );
}
