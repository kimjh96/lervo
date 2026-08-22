import { createPrivateKey } from "node:crypto";
import type { AddressInfo } from "node:net";

import { OwnerOnlyFileSystemCas } from "@lervo/cas";
import {
  ConfiguredBearerAuthenticator,
  createHubServerWithArtifactCleanup,
  type HubArtifactCleanupLifecycleResult,
} from "@lervo/hub";
import { HubControlReviewGrants } from "@lervo/hub-control";
import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { Ed25519PolicySigner } from "@lervo/policy";
import { Ed25519RemoteCommandSigner } from "@lervo/remote-command";

import type { HubRuntimeConfig } from "./config-types.js";
import { HubRuntimeError } from "./errors.js";
import { readOwnerOnlyFile } from "./secure-file.js";
import { prepareOwnerOnlyDatabasePath } from "./secure-storage.js";

const MAXIMUM_PRIVATE_KEY_BYTES = 16_384;
const MAXIMUM_REVIEW_SECRET_BYTES = 4_096;

export interface HubRuntimeListeningAddress {
  host: "127.0.0.1" | "::1";
  port: number;
}

export interface HubRuntimeCloseResult {
  status: "stopped" | "failed";
  failureCode?: "artifact_cleanup_runtime_failed" | "hub_server_runtime_failed";
  artifactCleanup: HubArtifactCleanupLifecycleResult;
}

export interface HubRuntimeDeployment {
  readonly closed: Promise<HubRuntimeCloseResult>;
  listen(): Promise<HubRuntimeListeningAddress>;
  close(): Promise<HubRuntimeCloseResult>;
}

async function closeServer(server: ReturnType<typeof createHubServerWithArtifactCleanup>["server"]): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) =>
    error === undefined ? resolve() : reject(error)
  ));
}

class DefaultHubRuntimeDeployment implements HubRuntimeDeployment {
  readonly closed: Promise<HubRuntimeCloseResult>;
  private listenStarted = false;
  private closePromise: Promise<HubRuntimeCloseResult> | null = null;
  private failureCode: HubRuntimeCloseResult["failureCode"];
  private resolveClosed!: (result: HubRuntimeCloseResult) => void;
  private rejectClosed!: (error: unknown) => void;

  constructor(
    private readonly listenAddress: HubRuntimeConfig["listen"],
    private readonly store: HubSyncSQLiteStore,
    private readonly server: ReturnType<typeof createHubServerWithArtifactCleanup>["server"],
    private readonly artifactCleanup:
      ReturnType<typeof createHubServerWithArtifactCleanup>["artifactCleanup"],
  ) {
    this.closed = new Promise<HubRuntimeCloseResult>((resolve, reject) => {
      this.resolveClosed = resolve;
      this.rejectClosed = reject;
    });
    this.server.once("close", () => {
      if (this.closePromise === null) this.beginFinalization(this.finishResources());
    });
    this.server.on("error", () => {
      if (this.listenStarted) {
        this.failureCode ??= "hub_server_runtime_failed";
        void this.close();
      }
    });
  }

  markArtifactCleanupFailure(): void {
    this.failureCode ??= "artifact_cleanup_runtime_failed";
    queueMicrotask(() => { void this.close(); });
  }

  async listen(): Promise<HubRuntimeListeningAddress> {
    if (this.listenStarted || this.closePromise !== null) {
      throw new HubRuntimeError("listen_failed", "Hub runtime은 한 번만 시작할 수 있습니다.");
    }
    this.listenStarted = true;
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => {
          this.server.off("listening", listening);
          reject(error);
        };
        const listening = () => {
          this.server.off("error", failed);
          resolve();
        };
        this.server.once("error", failed);
        this.server.once("listening", listening);
        this.server.listen(this.listenAddress.port, this.listenAddress.host);
      });
      const address = this.server.address() as AddressInfo | null;
      if (address === null || typeof address === "string") throw new Error("missing address");
      return { host: this.listenAddress.host, port: address.port };
    } catch (error) {
      this.failureCode ??= "hub_server_runtime_failed";
      await this.close().catch(() => undefined);
      throw new HubRuntimeError("listen_failed", "Hub runtime HTTP server를 시작하지 못했습니다.", {
        cause: error,
      });
    }
  }

  close(): Promise<HubRuntimeCloseResult> {
    if (this.closePromise === null) {
      this.beginFinalization(this.shutdown());
    }
    return this.closePromise!;
  }

  private beginFinalization(finalization: Promise<HubRuntimeCloseResult>): void {
    this.closePromise = finalization;
    void finalization.then(this.resolveClosed, this.rejectClosed);
  }

  private async shutdown(): Promise<HubRuntimeCloseResult> {
    let closeFailure: unknown;
    try {
      await closeServer(this.server);
    } catch (error) {
      closeFailure = error;
    }
    const result = await this.finishResources();
    if (closeFailure !== undefined) {
      throw new HubRuntimeError("shutdown_failed", "Hub runtime HTTP server를 종료하지 못했습니다.", {
        cause: closeFailure,
      });
    }
    return result;
  }

  private async finishResources(): Promise<HubRuntimeCloseResult> {
    try {
      const artifactCleanup = await this.artifactCleanup.stop();
      await this.store.close();
      return this.failureCode === undefined
        ? { status: "stopped", artifactCleanup }
        : { status: "failed", failureCode: this.failureCode, artifactCleanup };
    } catch (error) {
      throw new HubRuntimeError("shutdown_failed", "Hub runtime 저장소를 안전하게 종료하지 못했습니다.", {
        cause: error,
      });
    }
  }
}

export async function openHubRuntime(config: HubRuntimeConfig): Promise<HubRuntimeDeployment> {
  try {
    if ((config.listen.host !== "127.0.0.1" && config.listen.host !== "::1") ||
      !Number.isSafeInteger(config.listen.port) || config.listen.port < 1 ||
      config.listen.port > 65_535) {
      throw new HubRuntimeError(
        "invalid_config",
        "TLS가 없는 Hub runtime은 유효한 loopback 주소에서만 실행할 수 있습니다.",
      );
    }
    const [policyKeyBytes, commandKeyBytes, reviewSecret] = await Promise.all([
      readOwnerOnlyFile(config.signing.policy.privateKeyPath, MAXIMUM_PRIVATE_KEY_BYTES),
      readOwnerOnlyFile(config.signing.command.privateKeyPath, MAXIMUM_PRIVATE_KEY_BYTES),
      readOwnerOnlyFile(config.control.reviewGrantSecretPath, MAXIMUM_REVIEW_SECRET_BYTES),
    ]);
    let policySigner: Ed25519PolicySigner;
    let commandSigner: Ed25519RemoteCommandSigner;
    let reviewGrants: HubControlReviewGrants;
    try {
      policySigner = new Ed25519PolicySigner(
        config.signing.policy.keyId,
        createPrivateKey(policyKeyBytes),
      );
      commandSigner = new Ed25519RemoteCommandSigner(
        config.signing.command.keyId,
        createPrivateKey(commandKeyBytes),
      );
      reviewGrants = new HubControlReviewGrants(reviewSecret, {
        ...(config.control.reviewGrantTtlSeconds === undefined ? {} : {
          ttlSeconds: config.control.reviewGrantTtlSeconds,
        }),
      });
    } finally {
      policyKeyBytes.fill(0);
      commandKeyBytes.fill(0);
      reviewSecret.fill(0);
    }
    const authenticator = new ConfiguredBearerAuthenticator(config.credentials);
    const databasePath = await prepareOwnerOnlyDatabasePath(config.storage.databasePath);
    const store = await HubSyncSQLiteStore.open({ path: databasePath });
    try {
      const artifacts = await OwnerOnlyFileSystemCas.open(config.storage.commandCasPath);
      let deployment!: DefaultHubRuntimeDeployment;
      const composed = createHubServerWithArtifactCleanup({
        trace: { authenticator, source: store },
        policy: {
          authenticator,
          store,
          signer: policySigner,
          hubIdentityHash: config.identity.hubIdentityHash,
        },
        control: { authenticator, source: store, reviewGrants },
        commands: {
          authenticator,
          store,
          hubIdentityHash: config.identity.hubIdentityHash,
          authoring: { store, artifacts, signer: commandSigner },
        },
        artifactCleanup: {
          schedule: store,
          repository: store,
          artifacts,
          ...config.cleanup,
        },
        onArtifactCleanupFailure: () => deployment.markArtifactCleanupFailure(),
      });
      deployment = new DefaultHubRuntimeDeployment(
        { ...config.listen },
        store,
        composed.server,
        composed.artifactCleanup,
      );
      return deployment;
    } catch (error) {
      await store.close().catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (error instanceof HubRuntimeError) throw error;
    throw new HubRuntimeError("startup_failed", "Hub runtime 구성을 열지 못했습니다.", {
      cause: error,
    });
  }
}
