import { randomUUID } from "node:crypto";
import { chmod, lstat, open, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { createEventReaderCapabilities } from "@lervo/event-contract";
import type { SyncCycleResult, WorkstreamReplicationCycleResult } from "@lervo/sync";

import type { RemoteControlCycleResult } from "./control-loop.js";
import { NodeRuntimeError } from "./errors.js";
import type {
  NodeRuntimeComponentHealth,
  NodeRuntimeEventReaderIdentity,
  NodeRuntimeHealthSnapshot,
} from "./health-contract.js";

export const NODE_RUNTIME_HEALTH_FILE = "node-runtime-health.json";

/** ADR-0480: how often a `starting` snapshot refreshes `updatedAt` as process liveness. */
export const NODE_RUNTIME_STARTING_HEARTBEAT_MS = 5_000;

export interface NodeRuntimeHealthPublisherOptions {
  startingHeartbeatMs?: number;
  /** Called once, when the aggregate first leaves `starting` for `ready` or `degraded`. */
  onSettled?(): void;
  /** The clock that stamps when a Lervo debt reason was first observed. */
  now?: () => Date;
}

export interface NodeRuntimeHealthPublisher {
  readonly path: string;
  initialize(): Promise<void>;
  observeSync(result: SyncCycleResult): Promise<void>;
  observeWorkstreamReplication(result: WorkstreamReplicationCycleResult): Promise<void>;
  observeWorkstreamReplicationFailure(code: string): Promise<void>;
  observeWorkspaceCoordination(): Promise<void>;
  observeWorkspaceCoordinationFailure(code: string): Promise<void>;
  observeRemoteControl(result: RemoteControlCycleResult): Promise<void>;
  observeConversationReady(): Promise<void>;
  observeSupervision(health: NodeRuntimeComponentHealth): Promise<void>;
  observeConversationFailure(code: string): Promise<void>;
  stopping(): Promise<void>;
  /** Stops the starting heartbeat without publishing; used when startup fails. */
  close(): void;
}

function aggregate(snapshot: NodeRuntimeHealthSnapshot): NodeRuntimeHealthSnapshot["status"] {
  if (snapshot.status === "stopping") return "stopping";
  if (
    snapshot.sync.status === "unavailable" ||
    snapshot.workstreamReplication.status === "unavailable" ||
    snapshot.workspaceCoordination.status === "unavailable" ||
    snapshot.remoteControl.status === "unavailable" ||
    snapshot.conversation?.status === "unavailable" ||
    snapshot.supervision?.status === "unavailable"
  ) {
    return "degraded";
  }
  if (
    snapshot.sync.status === "ready" &&
    (snapshot.workstreamReplication.status === "ready" ||
      snapshot.workstreamReplication.status === "lervo_debt") &&
    (snapshot.workspaceCoordination.status === "ready" ||
      snapshot.workspaceCoordination.status === "disabled") &&
    (snapshot.remoteControl.status === "ready" || snapshot.remoteControl.status === "disabled") &&
    (snapshot.conversation === undefined ||
      snapshot.conversation.status === "ready" ||
      snapshot.conversation.status === "disabled") &&
    (snapshot.supervision === undefined ||
      snapshot.supervision.status === "ready" ||
      snapshot.supervision.status === "dormant" ||
      snapshot.supervision.status === "attention" ||
      snapshot.supervision.status === "lervo_debt" ||
      snapshot.supervision.status === "disabled")
  ) {
    return "ready";
  }
  return "starting";
}

/** A Lervo debt component keeps the time its reason was first observed. */
function withDebtSince(
  prior: NodeRuntimeComponentHealth | undefined,
  next: NodeRuntimeComponentHealth,
  now: Date,
): NodeRuntimeComponentHealth {
  if (next.status !== "lervo_debt") return structuredClone(next);
  const since =
    prior?.status === "lervo_debt" && prior.reasonCode === next.reasonCode && prior.since
      ? prior.since
      : now.toISOString();
  return { status: "lervo_debt", reasonCode: next.reasonCode, since };
}

function syncHealth(result: SyncCycleResult): NodeRuntimeComponentHealth {
  return result.status === "idle" || result.status === "synchronized"
    ? { status: "ready" }
    : { status: "unavailable", failureCode: result.failureCode };
}

function remoteControlHealth(result: RemoteControlCycleResult): NodeRuntimeComponentHealth {
  if (result.status === "policy_rejected") {
    return { status: "unavailable", failureCode: result.failureCode };
  }
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
  private publishedContent: string | null = null;
  private publishedAt = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private settled = false;

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  constructor(
    stateDirectory: string,
    remoteControlConfigured: boolean,
    workspaceCoordinationConfigured: boolean,
    eventReaderIdentity: NodeRuntimeEventReaderIdentity | undefined,
    conversationConfigured: boolean,
    supervisionConfigured: boolean,
    private readonly options: NodeRuntimeHealthPublisherOptions,
  ) {
    this.path = resolve(stateDirectory, NODE_RUNTIME_HEALTH_FILE);
    const now = new Date().toISOString();
    this.snapshot = {
      schemaVersion: 1,
      status: "starting",
      processId: process.pid,
      startedAt: now,
      updatedAt: now,
      eventReader: createEventReaderCapabilities(),
      ...(eventReaderIdentity === undefined
        ? {}
        : { eventReaderIdentity: structuredClone(eventReaderIdentity) }),
      sync: { status: "pending" },
      workstreamReplication: { status: "pending" },
      workspaceCoordination: workspaceCoordinationConfigured
        ? { status: "pending" }
        : { status: "disabled" },
      remoteControl: remoteControlConfigured ? { status: "pending" } : { status: "disabled" },
      conversation: conversationConfigured ? { status: "pending" } : { status: "disabled" },
      ...(supervisionConfigured ? { supervision: { status: "pending" as const } } : {}),
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

  observeSupervision(health: NodeRuntimeComponentHealth): Promise<void> {
    return this.publish(() => {
      this.snapshot.supervision = withDebtSince(this.snapshot.supervision, health, this.now());
    });
  }

  observeSync(result: SyncCycleResult): Promise<void> {
    return this.publish(() => {
      this.snapshot.sync = syncHealth(result);
    });
  }

  observeWorkstreamReplication(result: WorkstreamReplicationCycleResult): Promise<void> {
    return this.publish(() => {
      // ADR-0561: divergent heads Lervo could not reconcile yet are its own debt.
      this.snapshot.workstreamReplication = withDebtSince(
        this.snapshot.workstreamReplication,
        result.status === "divergent"
          ? { status: "lervo_debt", reasonCode: "divergent_heads" }
          : { status: "ready" },
        this.now(),
      );
    });
  }

  observeWorkstreamReplicationFailure(code: string): Promise<void> {
    return this.publish(() => {
      this.snapshot.workstreamReplication = { status: "unavailable", failureCode: code };
    });
  }

  observeWorkspaceCoordination(): Promise<void> {
    return this.publish(() => {
      this.snapshot.workspaceCoordination = { status: "ready" };
    });
  }

  observeWorkspaceCoordinationFailure(code: string): Promise<void> {
    return this.publish(() => {
      this.snapshot.workspaceCoordination = { status: "unavailable", failureCode: code };
    });
  }

  observeRemoteControl(result: RemoteControlCycleResult): Promise<void> {
    return this.publish(() => {
      this.snapshot.remoteControl = remoteControlHealth(result);
    });
  }

  observeConversationReady(): Promise<void> {
    return this.publish(() => {
      this.snapshot.conversation = { status: "ready" };
    });
  }

  observeConversationFailure(code: string): Promise<void> {
    return this.publish(() => {
      this.snapshot.conversation = { status: "unavailable", failureCode: code };
    });
  }

  stopping(): Promise<void> {
    return this.publish(() => {
      this.snapshot.status = "stopping";
    });
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
  }

  /**
   * A slow but live startup keeps `updatedAt` advancing, so readiness observers can tell it from
   * a hung or crashed process. A blocked event loop delays the heartbeat, which is intended. It
   * runs whenever the status is `starting`, also after a component was briefly unavailable.
   */
  private startHeartbeat(): void {
    if (this.heartbeat !== null || this.snapshot.status !== "starting" || this.closed) return;
    this.heartbeat = setInterval(() => {
      this.publish(() => undefined).catch(() => this.stopHeartbeat());
    }, this.options.startingHeartbeatMs ?? NODE_RUNTIME_STARTING_HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === null) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private publish(update: () => void): Promise<void> {
    const operation = this.pending.then(async () => {
      update();
      this.snapshot.status = aggregate(this.snapshot);
      if (this.snapshot.status !== "starting") this.stopHeartbeat();
      else this.startHeartbeat();
      if (
        !this.settled &&
        (this.snapshot.status === "ready" || this.snapshot.status === "degraded")
      ) {
        this.settled = true;
        this.options.onSettled?.();
      }
      const now = Date.now();
      const content = JSON.stringify({ ...this.snapshot, updatedAt: null });
      if (
        content === this.publishedContent &&
        now >= this.publishedAt &&
        now - this.publishedAt < 1_000
      )
        return;
      this.snapshot.updatedAt = new Date(now).toISOString();
      await atomicOwnerOnlyWrite(this.path, this.snapshot);
      this.publishedContent = content;
      this.publishedAt = now;
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}

export function createNodeRuntimeHealthPublisher(
  stateDirectory: string,
  remoteControlConfigured: boolean,
  workspaceCoordinationConfigured = false,
  eventReaderIdentity?: NodeRuntimeEventReaderIdentity,
  conversationConfigured = false,
  supervisionConfigured = false,
  options: NodeRuntimeHealthPublisherOptions = {},
): NodeRuntimeHealthPublisher {
  return new FileNodeRuntimeHealthPublisher(
    stateDirectory,
    remoteControlConfigured,
    workspaceCoordinationConfigured,
    eventReaderIdentity,
    conversationConfigured,
    supervisionConfigured,
    options,
  );
}
