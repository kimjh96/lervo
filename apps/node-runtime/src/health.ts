import { randomUUID } from "node:crypto";
import { chmod, lstat, open, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import type { SyncCycleResult, WorkstreamReplicationCycleResult } from "@lervo/sync";

import type { RemoteControlCycleResult } from "./control-loop.js";
import { NodeRuntimeError } from "./errors.js";

export const NODE_RUNTIME_HEALTH_FILE = "node-runtime-health.json";

type ComponentHealth =
  | { status: "pending" | "ready" | "disabled" }
  | { status: "unavailable"; failureCode: string };

export interface NodeRuntimeHealthSnapshot {
  schemaVersion: 1;
  status: "starting" | "ready" | "degraded" | "stopping";
  processId: number;
  startedAt: string;
  updatedAt: string;
  sync: ComponentHealth;
  workstreamReplication: ComponentHealth;
  remoteControl: ComponentHealth;
}

export interface NodeRuntimeHealthPublisher {
  readonly path: string;
  initialize(): Promise<void>;
  observeSync(result: SyncCycleResult): Promise<void>;
  observeWorkstreamReplication(result: WorkstreamReplicationCycleResult): Promise<void>;
  observeWorkstreamReplicationFailure(code: string): Promise<void>;
  observeRemoteControl(result: RemoteControlCycleResult): Promise<void>;
  stopping(): Promise<void>;
}

function aggregate(snapshot: NodeRuntimeHealthSnapshot): NodeRuntimeHealthSnapshot["status"] {
  if (snapshot.status === "stopping") return "stopping";
  if (snapshot.sync.status === "unavailable" || snapshot.workstreamReplication.status === "unavailable" || snapshot.remoteControl.status === "unavailable") {
    return "degraded";
  }
  if (snapshot.sync.status === "ready" && snapshot.workstreamReplication.status === "ready" &&
    (snapshot.remoteControl.status === "ready" || snapshot.remoteControl.status === "disabled")) {
    return "ready";
  }
  return "starting";
}

function syncHealth(result: SyncCycleResult): ComponentHealth {
  return result.status === "idle" || result.status === "synchronized"
    ? { status: "ready" }
    : { status: "unavailable", failureCode: result.failureCode };
}

function remoteControlHealth(result: RemoteControlCycleResult): ComponentHealth {
  if (result.status === "policy_unavailable") {
    return { status: "unavailable", failureCode: result.policy.failureCode };
  }
  const command = result.command;
  return command.status === "idle" || command.status === "processed"
    ? { status: "ready" }
    : { status: "unavailable", failureCode: command.failureCode };
}

async function assertStateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("unsafe state directory");
  }
}

async function atomicOwnerOnlyWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

class FileNodeRuntimeHealthPublisher implements NodeRuntimeHealthPublisher {
  readonly path: string;
  private snapshot: NodeRuntimeHealthSnapshot;
  private pending: Promise<void> = Promise.resolve();

  constructor(stateDirectory: string, remoteControlConfigured: boolean) {
    this.path = resolve(stateDirectory, NODE_RUNTIME_HEALTH_FILE);
    const now = new Date().toISOString();
    this.snapshot = {
      schemaVersion: 1,
      status: "starting",
      processId: process.pid,
      startedAt: now,
      updatedAt: now,
      sync: { status: "pending" },
      workstreamReplication: { status: "pending" },
      remoteControl: remoteControlConfigured ? { status: "pending" } : { status: "disabled" },
    };
  }

  async initialize(): Promise<void> {
    try {
      await assertStateDirectory(resolve(this.path, ".."));
      await this.publish(() => undefined);
    } catch (error) {
      throw new NodeRuntimeError(
        "startup_failed",
        "Could not initialize the Node runtime readiness snapshot.",
        { cause: error },
      );
    }
  }

  observeSync(result: SyncCycleResult): Promise<void> {
    return this.publish(() => { this.snapshot.sync = syncHealth(result); });
  }

  observeWorkstreamReplication(result: WorkstreamReplicationCycleResult): Promise<void> {
    return this.publish(() => {
      this.snapshot.workstreamReplication = result.status === "divergent"
        ? { status: "unavailable", failureCode: "divergent_heads" }
        : { status: "ready" };
    });
  }

  observeWorkstreamReplicationFailure(code: string): Promise<void> {
    return this.publish(() => {
      this.snapshot.workstreamReplication = { status: "unavailable", failureCode: code };
    });
  }

  observeRemoteControl(result: RemoteControlCycleResult): Promise<void> {
    return this.publish(() => { this.snapshot.remoteControl = remoteControlHealth(result); });
  }

  stopping(): Promise<void> {
    return this.publish(() => { this.snapshot.status = "stopping"; });
  }

  private publish(update: () => void): Promise<void> {
    const operation = this.pending.then(async () => {
      update();
      this.snapshot.updatedAt = new Date().toISOString();
      this.snapshot.status = aggregate(this.snapshot);
      await atomicOwnerOnlyWrite(this.path, this.snapshot);
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}

export function createNodeRuntimeHealthPublisher(
  stateDirectory: string,
  remoteControlConfigured: boolean,
): NodeRuntimeHealthPublisher {
  return new FileNodeRuntimeHealthPublisher(stateDirectory, remoteControlConfigured);
}
