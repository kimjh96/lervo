import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { OrganizationRuntimeCredentialDeliveryReceipt } from "@lervo/schemas";
import { type OutboundSyncLoopResult } from "@lervo/sync";

import { type RemoteControlLoopResult } from "./control-loop.js";
import { NodeRuntimeError } from "./errors.js";
import type { NodeRuntimeHealthPublisher } from "./health.js";
import type {
  NodeOrganizationCredentialDelivery,
  NodeOrganizationCredentialDeliveryRequest,
} from "./organization-credential-delivery.js";

export interface NodeRuntimeCloseResult {
  status: "stopped" | "failed";
  failureCode?: "sync_runtime_failed" | "remote_control_runtime_failed";
  sync: OutboundSyncLoopResult | null;
  remoteControl: RemoteControlLoopResult | null;
}

export interface NodeRuntimeDeployment {
  readonly closed: Promise<NodeRuntimeCloseResult>;
  start(): Promise<void>;
  reloadBearerToken(): Promise<void>;
  reloadRuntimeMaterials(): Promise<void>;
  deliverOrganizationCredential(
    request: NodeOrganizationCredentialDeliveryRequest,
  ): Promise<OrganizationRuntimeCredentialDeliveryReceipt>;
  close(): Promise<NodeRuntimeCloseResult>;
}

class DefaultNodeRuntimeDeployment implements NodeRuntimeDeployment {
  readonly closed: Promise<NodeRuntimeCloseResult>;
  private readonly abort = new AbortController();
  private started = false;
  private syncLoop: Promise<OutboundSyncLoopResult> | null = null;
  private controlLoop: Promise<RemoteControlLoopResult> | null = null;
  private closePromise: Promise<NodeRuntimeCloseResult> | null = null;
  private reloadPromise: Promise<void> | null = null;
  private materialReloadPromise: Promise<void> | null = null;
  private organizationCredentialDeliveryPromise: Promise<OrganizationRuntimeCredentialDeliveryReceipt> | null =
    null;
  private failureCode: NodeRuntimeCloseResult["failureCode"];
  private resolveClosed!: (result: NodeRuntimeCloseResult) => void;
  private rejectClosed!: (error: unknown) => void;

  constructor(
    private readonly store: SQLiteEventStore,
    private readonly runSyncLoop: (signal: AbortSignal) => Promise<OutboundSyncLoopResult>,
    private readonly control: {
      run(signal: AbortSignal): Promise<RemoteControlLoopResult>;
      close(): void;
    } | null,
    private readonly reloadBearerTokenSnapshot: () => Promise<void>,
    private readonly reloadRuntimeMaterialSnapshot: () => Promise<void>,
    private readonly health: Pick<NodeRuntimeHealthPublisher, "stopping"> | null,
    private readonly organizationCredentialDelivery: NodeOrganizationCredentialDelivery | null,
  ) {
    this.closed = new Promise<NodeRuntimeCloseResult>((resolve, reject) => {
      this.resolveClosed = resolve;
      this.rejectClosed = reject;
    });
  }

  async start(): Promise<void> {
    if (this.started || this.closePromise !== null) {
      throw new NodeRuntimeError("startup_failed", "The Node runtime can be started only once.");
    }
    this.started = true;
    this.syncLoop = Promise.resolve().then(() => this.runSyncLoop(this.abort.signal));
    void this.syncLoop.catch(() => {
      this.failureCode ??= "sync_runtime_failed";
      void this.close();
    });
    const control = this.control;
    if (control !== null) {
      this.controlLoop = Promise.resolve().then(() => control.run(this.abort.signal));
      void this.controlLoop.catch(() => {
        this.failureCode ??= "remote_control_runtime_failed";
        void this.close();
      });
    }
  }

  close(): Promise<NodeRuntimeCloseResult> {
    if (this.closePromise === null) {
      this.abort.abort();
      this.closePromise =
        this.health
          ?.stopping()
          .catch(() => undefined)
          .then(() => this.finish()) ?? this.finish();
      void this.closePromise.then(this.resolveClosed, this.rejectClosed);
    }
    return this.closePromise;
  }

  reloadBearerToken(): Promise<void> {
    if (this.closePromise !== null || this.organizationCredentialDeliveryPromise !== null) {
      return Promise.reject(
        new NodeRuntimeError(
          "token_reload_failed",
          "Cannot reload the Node runtime bearer token while the runtime is shutting down.",
        ),
      );
    }
    if (this.reloadPromise === null) {
      const operation = this.reloadBearerTokenSnapshot().catch((error) => {
        throw new NodeRuntimeError(
          "token_reload_failed",
          "Could not reload the Node runtime bearer token.",
          { cause: error },
        );
      });
      this.reloadPromise = operation;
      void operation
        .finally(() => {
          if (this.reloadPromise === operation) this.reloadPromise = null;
        })
        .catch(() => undefined);
    }
    return this.reloadPromise;
  }

  reloadRuntimeMaterials(): Promise<void> {
    if (this.closePromise !== null || this.organizationCredentialDeliveryPromise !== null) {
      return Promise.reject(
        new NodeRuntimeError(
          "runtime_material_reload_failed",
          "Cannot reload Node runtime material while the runtime is shutting down.",
        ),
      );
    }
    if (this.materialReloadPromise === null) {
      const operation = this.reloadRuntimeMaterialSnapshot().catch((error) => {
        throw new NodeRuntimeError(
          "runtime_material_reload_failed",
          "Could not reload Node runtime material.",
          { cause: error },
        );
      });
      this.materialReloadPromise = operation;
      void operation
        .finally(() => {
          if (this.materialReloadPromise === operation) this.materialReloadPromise = null;
        })
        .catch(() => undefined);
    }
    return this.materialReloadPromise;
  }

  deliverOrganizationCredential(
    request: NodeOrganizationCredentialDeliveryRequest,
  ): Promise<OrganizationRuntimeCredentialDeliveryReceipt> {
    if (
      this.closePromise !== null ||
      this.organizationCredentialDelivery === null ||
      this.reloadPromise !== null ||
      this.materialReloadPromise !== null
    ) {
      return Promise.reject(
        new NodeRuntimeError(
          "organization_credential_delivery_failed",
          "Organization credential delivery is unavailable for this Node runtime.",
        ),
      );
    }
    if (this.organizationCredentialDeliveryPromise !== null) {
      return Promise.reject(
        new NodeRuntimeError(
          "organization_credential_delivery_failed",
          "Another organization credential delivery is already in progress.",
        ),
      );
    }
    const operation = this.organizationCredentialDelivery.deliver(request);
    this.organizationCredentialDeliveryPromise = operation;
    void operation
      .finally(() => {
        if (this.organizationCredentialDeliveryPromise === operation)
          this.organizationCredentialDeliveryPromise = null;
      })
      .catch(() => undefined);
    return operation;
  }

  private async finish(): Promise<NodeRuntimeCloseResult> {
    let sync: OutboundSyncLoopResult | null = null;
    let remoteControl: RemoteControlLoopResult | null = null;
    try {
      if (this.syncLoop !== null) sync = await this.syncLoop;
    } catch {
      this.failureCode ??= "sync_runtime_failed";
    }
    try {
      if (this.controlLoop !== null) remoteControl = await this.controlLoop;
    } catch {
      this.failureCode ??= "remote_control_runtime_failed";
    }
    const shutdownErrors: unknown[] = [];
    try {
      this.control?.close();
    } catch (error) {
      shutdownErrors.push(error);
    }
    try {
      this.store.close();
    } catch (error) {
      shutdownErrors.push(error);
    }
    if (shutdownErrors.length > 0) {
      throw new NodeRuntimeError(
        "shutdown_failed",
        "Could not close the Node runtime repository safely.",
        { cause: new AggregateError(shutdownErrors) },
      );
    }
    return this.failureCode === undefined
      ? { status: "stopped", sync, remoteControl }
      : { status: "failed", failureCode: this.failureCode, sync, remoteControl };
  }
}

export function createNodeRuntimeDeployment(
  store: SQLiteEventStore,
  runLoop: (signal: AbortSignal) => Promise<OutboundSyncLoopResult>,
  control: {
    run(signal: AbortSignal): Promise<RemoteControlLoopResult>;
    close(): void;
  } | null = null,
  reloadBearerToken: () => Promise<void> = async () => undefined,
  reloadRuntimeMaterials: () => Promise<void> = reloadBearerToken,
  health: Pick<NodeRuntimeHealthPublisher, "stopping"> | null = null,
  organizationCredentialDelivery: NodeOrganizationCredentialDelivery | null = null,
): NodeRuntimeDeployment {
  return new DefaultNodeRuntimeDeployment(
    store,
    runLoop,
    control,
    reloadBearerToken,
    reloadRuntimeMaterials,
    health,
    organizationCredentialDelivery,
  );
}
