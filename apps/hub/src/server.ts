import { createHubRuntimeChangeHandler } from "./runtime-change-handler.js";
import type { HubRuntimeChangeSource } from "@lervo/hub-sync";
import { createServer, type RequestListener, type Server } from "node:http";

import { type HubCommandArtifactCleanupLoopOptions } from "@lervo/hub-command";

import {
  createHubControlHttpHandler,
  type HubControlHttpHandlerOptions,
} from "./control-handler.js";
import {
  createHubRemoteCommandHttpHandler,
  type HubRemoteCommandHttpHandlerOptions,
} from "./command-handler.js";
import { createHubTraceHttpHandler, type HubTraceHttpHandlerOptions } from "./handler.js";
import { createHubPolicyHttpHandler, type HubPolicyHttpHandlerOptions } from "./policy-handler.js";
import { createHubWebHandler } from "./web-handler.js";
import {
  attachHubArtifactCleanupLifecycle,
  type HubArtifactCleanupLifecycle,
} from "./artifact-cleanup-lifecycle.js";
import { createHubSyncHttpHandler, type HubSyncHttpHandlerOptions } from "./sync-handler.js";
import { createHubHealthHttpHandler, type HubHealthHttpHandlerOptions } from "./health-handler.js";
import {
  createHubCapabilityHttpHandler,
  type HubCapabilityHttpHandlerOptions,
} from "./capability-handler.js";

export interface HubServerOptions {
  trace: HubTraceHttpHandlerOptions;
  policy?: HubPolicyHttpHandlerOptions;
  control?: HubControlHttpHandlerOptions;
  commands?: HubRemoteCommandHttpHandlerOptions;
  sync?: HubSyncHttpHandlerOptions;
  health?: HubHealthHttpHandlerOptions;
  capabilities?: HubCapabilityHttpHandlerOptions;
}

export function createHubTraceServer(options: HubTraceHttpHandlerOptions): Server {
  return createHubServer({ trace: options });
}

export function createHubRequestListener(options: HubServerOptions): RequestListener {
  const changesHandler = createHubRuntimeChangeHandler({
    ...(options.sync === undefined
      ? {}
      : {
          workstream: {
            ...options.sync,
            store: options.sync.store as typeof options.sync.store &
              Partial<HubRuntimeChangeSource>,
          },
        }),
    ...(options.sync === undefined
      ? {}
      : {
          knowledge: {
            ...options.sync,
            store: options.sync.store as typeof options.sync.store &
              Partial<HubRuntimeChangeSource>,
          },
        }),
    ...(options.commands === undefined
      ? {}
      : {
          command: {
            ...options.commands,
            store: options.commands.store as typeof options.commands.store &
              Partial<HubRuntimeChangeSource>,
          },
        }),
  });
  const traceHandler = createHubTraceHttpHandler(options.trace);
  const policyHandler =
    options.policy === undefined ? undefined : createHubPolicyHttpHandler(options.policy);
  const controlHandler =
    options.control === undefined ? undefined : createHubControlHttpHandler(options.control);
  const commandHandler =
    options.commands === undefined
      ? undefined
      : createHubRemoteCommandHttpHandler(options.commands);
  const syncHandler =
    options.sync === undefined ? undefined : createHubSyncHttpHandler(options.sync);
  const healthHandler =
    options.health === undefined ? undefined : createHubHealthHttpHandler(options.health);
  const capabilityHandler =
    options.capabilities === undefined
      ? undefined
      : createHubCapabilityHttpHandler(options.capabilities);
  const webHandler = createHubWebHandler();
  return (request, response) => {
    if (webHandler(request, response)) return;
    if (request.url?.startsWith("/v1/runtime-changes/") && changesHandler !== undefined) {
      void changesHandler(request, response);
    } else if (request.url?.startsWith("/v1/capabilities/") && capabilityHandler !== undefined) {
      void capabilityHandler(request, response);
    } else if (request.url?.startsWith("/v1/health/") && healthHandler !== undefined) {
      void healthHandler(request, response);
    } else if (request.url?.startsWith("/v1/sync/") && syncHandler !== undefined) {
      void syncHandler(request, response);
    } else if (request.url?.startsWith("/v1/commands/") && commandHandler !== undefined) {
      void commandHandler(request, response);
    } else if (request.url?.startsWith("/v1/control/") && controlHandler !== undefined) {
      void controlHandler(request, response);
    } else if (request.url?.startsWith("/v1/policy/") && policyHandler !== undefined) {
      void policyHandler(request, response);
    } else {
      void traceHandler(request, response);
    }
  };
}

/**
 * ADR-0602: held change waits stay open with no timer on either side, so the kernel's TCP
 * keepalive is what notices a peer that vanished; a dead socket closes its held request.
 */
export const HUB_SOCKET_KEEPALIVE_MILLISECONDS = 15_000;

export function createHubServer(options: HubServerOptions): Server {
  return createServer(
    { keepAlive: true, keepAliveInitialDelay: HUB_SOCKET_KEEPALIVE_MILLISECONDS },
    createHubRequestListener(options),
  );
}

export function createHubServerWithArtifactCleanup(
  options: HubServerOptions & {
    artifactCleanup: Omit<HubCommandArtifactCleanupLoopOptions, "signal">;
    onArtifactCleanupFailure?: (
      failureCode: "artifact_cleanup_runtime_failed",
    ) => void | Promise<void>;
  },
): { server: Server; artifactCleanup: HubArtifactCleanupLifecycle } {
  const server = createHubServer(options);
  return {
    server,
    artifactCleanup: attachHubArtifactCleanupLifecycle({
      server,
      runtime: options.artifactCleanup,
      ...(options.onArtifactCleanupFailure === undefined
        ? {}
        : {
            onFailure: options.onArtifactCleanupFailure,
          }),
    }),
  };
}
