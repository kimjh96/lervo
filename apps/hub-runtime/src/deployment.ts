import type { Server as HttpServer } from "node:http";
import { createServer as createSecureServer, type Server as SecureServer } from "node:https";
import type { AddressInfo } from "node:net";
import { createSecureContext } from "node:tls";

import { OwnerOnlyFileSystemCas } from "@lervo/cas";
import {
  ConfiguredBearerAuthenticator,
  ReloadableBearerAuthenticator,
  attachHubArtifactCleanupLifecycle,
  createHubRequestListener,
  createHubServerWithArtifactCleanup,
  type HubArtifactCleanupLifecycleResult,
} from "@lervo/hub";
import { HubControlReviewGrants } from "@lervo/hub-control";
import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";

import type { HubRuntimeConfig } from "./config-types.js";
import { HubRuntimeError } from "./errors.js";
import { loadHubRuntimeCredentials } from "./credentials.js";
import { readOwnerOnlyFile } from "./secure-file.js";
import { prepareOwnerOnlyDatabasePath } from "./secure-storage.js";
import {
  assertHubRuntimeSigningReplacement,
  loadHubRuntimeSigning,
  ReloadableCommandSigner,
  ReloadablePolicySigner,
} from "./signing.js";

const MAXIMUM_REVIEW_SECRET_BYTES = 4_096;
const MAXIMUM_TLS_CERTIFICATE_BYTES = 64 * 1_024;
const MAXIMUM_TLS_PRIVATE_KEY_BYTES = 64 * 1_024;

type HubRuntimeServer = HttpServer | SecureServer;

export interface HubRuntimeListeningAddress {
  host: string;
  port: number;
  protocol: "http" | "https";
}

export interface HubRuntimeCloseResult {
  status: "stopped" | "failed";
  failureCode?: "artifact_cleanup_runtime_failed" | "hub_server_runtime_failed";
  artifactCleanup: HubArtifactCleanupLifecycleResult;
}

export interface HubRuntimeDeployment {
  readonly closed: Promise<HubRuntimeCloseResult>;
  listen(): Promise<HubRuntimeListeningAddress>;
  reloadCredentials(): Promise<void>;
  reloadRuntimeMaterials(): Promise<void>;
  close(): Promise<HubRuntimeCloseResult>;
}

async function closeServer(server: HubRuntimeServer): Promise<void> {
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
  private reloadPromise: Promise<void> | null = null;
  private materialReloadPromise: Promise<void> | null = null;
  private resolveClosed!: (result: HubRuntimeCloseResult) => void;
  private rejectClosed!: (error: unknown) => void;

  constructor(
    private readonly listenAddress: HubRuntimeConfig["listen"],
    private readonly store: HubSyncSQLiteStore,
    private readonly server: HubRuntimeServer,
    private readonly artifactCleanup:
      ReturnType<typeof createHubServerWithArtifactCleanup>["artifactCleanup"],
    private readonly protocol: "http" | "https",
    private readonly reloadCredentialSnapshot: () => Promise<void>,
    private readonly reloadMaterialSnapshot: () => Promise<void>,
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
      throw new HubRuntimeError("listen_failed", "The Hub runtime can be started only once.");
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
      return { host: this.listenAddress.host, port: address.port, protocol: this.protocol };
    } catch (error) {
      this.failureCode ??= "hub_server_runtime_failed";
      await this.close().catch(() => undefined);
      throw new HubRuntimeError("listen_failed", "Could not start the Hub runtime HTTP server.", {
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

  reloadCredentials(): Promise<void> {
    if (this.closePromise !== null) {
      return Promise.reject(new HubRuntimeError(
        "credential_reload_failed",
        "Cannot reload Hub runtime credentials while the runtime is shutting down.",
      ));
    }
    if (this.reloadPromise === null) {
      const operation = this.reloadCredentialSnapshot().catch((error) => {
        throw new HubRuntimeError(
          "credential_reload_failed",
          "Could not reload Hub runtime credentials.",
          { cause: error },
        );
      });
      this.reloadPromise = operation;
      void operation.finally(() => {
        if (this.reloadPromise === operation) this.reloadPromise = null;
      }).catch(() => undefined);
    }
    return this.reloadPromise;
  }

  reloadRuntimeMaterials(): Promise<void> {
    if (this.closePromise !== null) {
      return Promise.reject(new HubRuntimeError(
        "runtime_material_reload_failed",
        "Cannot reload Hub runtime material while the runtime is shutting down.",
      ));
    }
    if (this.materialReloadPromise === null) {
      const operation = this.reloadMaterialSnapshot().catch((error) => {
        throw new HubRuntimeError(
          "runtime_material_reload_failed",
          "Could not reload Hub runtime material.",
          { cause: error },
        );
      });
      this.materialReloadPromise = operation;
      void operation.finally(() => {
        if (this.materialReloadPromise === operation) this.materialReloadPromise = null;
      }).catch(() => undefined);
    }
    return this.materialReloadPromise;
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
      throw new HubRuntimeError("shutdown_failed", "Could not stop the Hub runtime HTTP server.", {
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
      throw new HubRuntimeError("shutdown_failed", "Could not close the Hub runtime repository safely.", {
        cause: error,
      });
    }
  }
}

interface LoadedTlsMaterial {
  certificate: Buffer;
  privateKey: Buffer;
}

async function loadTlsMaterial(config: NonNullable<HubRuntimeConfig["tls"]>): Promise<LoadedTlsMaterial> {
  const [certificate, privateKey] = await Promise.all([
    readOwnerOnlyFile(config.certificatePath, MAXIMUM_TLS_CERTIFICATE_BYTES),
    readOwnerOnlyFile(config.privateKeyPath, MAXIMUM_TLS_PRIVATE_KEY_BYTES),
  ]);
  try {
    createSecureContext({ cert: certificate, key: privateKey, minVersion: "TLSv1.3" });
    return { certificate, privateKey };
  } catch (error) {
    certificate.fill(0);
    privateKey.fill(0);
    throw new HubRuntimeError("invalid_config", "The Hub TLS material is invalid.", {
      cause: error,
    });
  }
}

function clearTlsMaterial(material: LoadedTlsMaterial | undefined): void {
  material?.certificate.fill(0);
  material?.privateKey.fill(0);
}

export async function openHubRuntime(config: HubRuntimeConfig): Promise<HubRuntimeDeployment> {
  try {
    if ((config.tls === undefined && config.listen.host !== "127.0.0.1" && config.listen.host !== "::1") ||
      typeof config.listen.host !== "string" || config.listen.host.length < 1 ||
      config.listen.host.length > 255 || config.listen.host.trim() !== config.listen.host ||
      /[\s/\\]/u.test(config.listen.host) ||
      !Number.isSafeInteger(config.listen.port) || config.listen.port < 1 ||
      config.listen.port > 65_535) {
      throw new HubRuntimeError(
        "invalid_config",
        "A Hub runtime without TLS may listen only on a valid loopback address.",
      );
    }
    const [loadedSigning, reviewSecret] = await Promise.all([
      loadHubRuntimeSigning(config),
      readOwnerOnlyFile(config.control.reviewGrantSecretPath, MAXIMUM_REVIEW_SECRET_BYTES),
    ]);
    const policySigner = new ReloadablePolicySigner(loadedSigning.policy);
    const commandSigner = new ReloadableCommandSigner(loadedSigning.command);
    let reviewGrants: HubControlReviewGrants;
    try {
      reviewGrants = new HubControlReviewGrants(reviewSecret, {
        ...(config.control.reviewGrantTtlSeconds === undefined ? {} : {
          ttlSeconds: config.control.reviewGrantTtlSeconds,
        }),
      });
    } finally {
      reviewSecret.fill(0);
    }
    const authenticator = new ReloadableBearerAuthenticator(
      await loadHubRuntimeCredentials(config),
    );
    const reloadCredentialSnapshot = async () => {
      if (config.credentialsFile === undefined) return;
      authenticator.replace(await loadHubRuntimeCredentials(config));
    };
    const databasePath = await prepareOwnerOnlyDatabasePath(config.storage.databasePath);
    const store = await HubSyncSQLiteStore.open({ path: databasePath });
    try {
      const artifacts = await OwnerOnlyFileSystemCas.open(config.storage.commandCasPath);
      let deployment!: DefaultHubRuntimeDeployment;
      const serverOptions = {
        health: {
          hubIdentityHash: config.identity.hubIdentityHash,
          checkReady: () => store.checkIntegrity(),
        },
        trace: { authenticator, source: store },
        sync: {
          authenticator,
          store,
          hubIdentityHash: config.identity.hubIdentityHash,
        },
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
      };
      let server: HubRuntimeServer;
      let artifactCleanup: ReturnType<typeof createHubServerWithArtifactCleanup>["artifactCleanup"];
      if (config.tls === undefined) {
        const composed = createHubServerWithArtifactCleanup({
          ...serverOptions,
          onArtifactCleanupFailure: () => deployment.markArtifactCleanupFailure(),
        });
        server = composed.server;
        artifactCleanup = composed.artifactCleanup;
      } else {
        const tls = await loadTlsMaterial(config.tls);
        try {
          server = createSecureServer({
            cert: tls.certificate,
            key: tls.privateKey,
            minVersion: "TLSv1.3",
          }, createHubRequestListener(serverOptions));
        } finally {
          clearTlsMaterial(tls);
        }
        artifactCleanup = attachHubArtifactCleanupLifecycle({
          server,
          runtime: serverOptions.artifactCleanup,
          onFailure: () => deployment.markArtifactCleanupFailure(),
        });
      }
      const reloadMaterialSnapshot = async () => {
        const [credentials, candidateSigning, tls] = await Promise.all([
          loadHubRuntimeCredentials(config),
          loadHubRuntimeSigning(config),
          config.tls === undefined ? Promise.resolve(undefined) : loadTlsMaterial(config.tls),
        ]);
        try {
          assertHubRuntimeSigningReplacement(loadedSigning, candidateSigning);
          if (tls !== undefined) {
            (server as SecureServer).setSecureContext({
              cert: tls.certificate,
              key: tls.privateKey,
            });
          }
          policySigner.replace(candidateSigning.policy);
          commandSigner.replace(candidateSigning.command);
          loadedSigning.policy = candidateSigning.policy;
          loadedSigning.command = candidateSigning.command;
          authenticator.replace(credentials);
        } finally {
          clearTlsMaterial(tls);
        }
      };
      deployment = new DefaultHubRuntimeDeployment(
        { ...config.listen },
        store,
        server,
        artifactCleanup,
        config.tls === undefined ? "http" : "https",
        reloadCredentialSnapshot,
        reloadMaterialSnapshot,
      );
      return deployment;
    } catch (error) {
      await store.close().catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (error instanceof HubRuntimeError) throw error;
    throw new HubRuntimeError("startup_failed", "Could not open the Hub runtime configuration.", {
      cause: error,
    });
  }
}
