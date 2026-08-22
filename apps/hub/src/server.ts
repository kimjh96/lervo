import { createServer, type Server } from "node:http";

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
import {
  createHubPolicyHttpHandler,
  type HubPolicyHttpHandlerOptions,
} from "./policy-handler.js";
import { createHubWebHandler } from "./web-handler.js";
import {
  attachHubArtifactCleanupLifecycle,
  type HubArtifactCleanupLifecycle,
} from "./artifact-cleanup-lifecycle.js";

export interface HubServerOptions {
  trace: HubTraceHttpHandlerOptions;
  policy?: HubPolicyHttpHandlerOptions;
  control?: HubControlHttpHandlerOptions;
  commands?: HubRemoteCommandHttpHandlerOptions;
}

export function createHubTraceServer(options: HubTraceHttpHandlerOptions): Server {
  return createHubServer({ trace: options });
}

export function createHubServer(options: HubServerOptions): Server {
  const traceHandler = createHubTraceHttpHandler(options.trace);
  const policyHandler = options.policy === undefined
    ? undefined
    : createHubPolicyHttpHandler(options.policy);
  const controlHandler = options.control === undefined
    ? undefined
    : createHubControlHttpHandler(options.control);
  const commandHandler = options.commands === undefined
    ? undefined
    : createHubRemoteCommandHttpHandler(options.commands);
  const webHandler = createHubWebHandler();
  return createServer((request, response) => {
    if (webHandler(request, response)) return;
    if (request.url?.startsWith("/v1/commands/") && commandHandler !== undefined) {
      void commandHandler(request, response);
    } else if (request.url?.startsWith("/v1/control/") && controlHandler !== undefined) {
      void controlHandler(request, response);
    } else if (request.url?.startsWith("/v1/policy/") && policyHandler !== undefined) {
      void policyHandler(request, response);
    } else {
      void traceHandler(request, response);
    }
  });
}

export function createHubServerWithArtifactCleanup(options: HubServerOptions & {
  artifactCleanup: Omit<HubCommandArtifactCleanupLoopOptions, "signal">;
  onArtifactCleanupFailure?: (
    failureCode: "artifact_cleanup_runtime_failed",
  ) => void | Promise<void>;
}): { server: Server; artifactCleanup: HubArtifactCleanupLifecycle } {
  const server = createHubServer(options);
  return {
    server,
    artifactCleanup: attachHubArtifactCleanupLifecycle({
      server,
      runtime: options.artifactCleanup,
      ...(options.onArtifactCleanupFailure === undefined ? {} : {
        onFailure: options.onArtifactCleanupFailure,
      }),
    }),
  };
}
