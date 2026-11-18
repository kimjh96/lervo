import {
  AuthenticatedHubHttpTransport,
  type AuthenticatedHubTransport,
  type AuthenticatedWorkstreamHubTransport,
  type SyncHttpTransportOptions,
} from "@lervo/sync";
import type { HubWorkspaceSummaryTransport } from "@lervo/workspace-reservation-hub";
import type { NodeRuntimeConfig } from "./config-types.js";
import type { NodeRuntimeOpenPorts } from "./open-ports.js";
import { RuntimeIdleWait } from "./runtime-idle-wait.js";

/** Keeps current-credential Hub transports and idle hints behind one deployment adapter boundary. */
export function createNodeDeploymentTransports(input: {
  config: NodeRuntimeConfig;
  target: SyncHttpTransportOptions["target"];
  bearerToken(): string;
  createTransport?: NodeRuntimeOpenPorts["createTransport"];
}) {
  const { config, target } = input;
  const transportOptions = (): SyncHttpTransportOptions => ({
    baseUrl: config.hub.baseUrl,
    bearerToken: input.bearerToken(),
    expectedHubIdentityHash: config.hub.hubIdentityHash,
    destinationId: config.hub.destinationId,
    target,
    ...(config.sync.requestTimeoutMs === undefined
      ? {}
      : {
          requestTimeoutMs: config.sync.requestTimeoutMs,
        }),
    ...(config.sync.maxRequestBytes === undefined
      ? {}
      : {
          maxRequestBytes: config.sync.maxRequestBytes,
        }),
    ...(config.sync.maxResponseBytes === undefined
      ? {}
      : {
          maxResponseBytes: config.sync.maxResponseBytes,
        }),
  });
  const createTransport =
    input.createTransport ?? ((options) => new AuthenticatedHubHttpTransport(options));
  const idleWait = new RuntimeIdleWait({
    transport: () => {
      const candidate = createTransport({
        ...transportOptions(),
        requestTimeoutMs: 30_000,
      }) as AuthenticatedHubHttpTransport;
      return typeof candidate.waitForRuntimeChange === "function" ? candidate : null;
    },
    topic: "workstream",
    destinationId: config.hub.destinationId,
    expectedPeerIdentityHash: config.hub.hubIdentityHash,
    fallbackIntervalMs: config.sync.idlePollIntervalMs ?? 2_000,
  });
  const transport: AuthenticatedHubTransport = {
    registerProject(request) {
      return createTransport(transportOptions()).registerProject(request);
    },
    sendEventBatch(batch) {
      return createTransport(transportOptions()).sendEventBatch(batch);
    },
  };
  const workstreamTransport: AuthenticatedWorkstreamHubTransport = {
    publishWorkstream(request) {
      const candidate = createTransport(transportOptions()) as AuthenticatedHubTransport &
        Partial<AuthenticatedWorkstreamHubTransport>;
      if (typeof candidate.publishWorkstream !== "function") {
        throw new Error("The configured Hub transport does not support workstream publication.");
      }
      return candidate.publishWorkstream(request);
    },
    readWorkstream() {
      const candidate = createTransport(transportOptions()) as AuthenticatedHubTransport &
        Partial<AuthenticatedWorkstreamHubTransport>;
      if (typeof candidate.readWorkstream !== "function") {
        throw new Error("The configured Hub transport does not support workstream reads.");
      }
      return candidate.readWorkstream();
    },
  };
  const workspaceTransport: HubWorkspaceSummaryTransport = {
    publishWorkspaceSummary(summary) {
      const candidate = createTransport(transportOptions()) as AuthenticatedHubTransport &
        Partial<HubWorkspaceSummaryTransport>;
      if (typeof candidate.publishWorkspaceSummary !== "function")
        throw new Error("The configured Hub transport does not support workspace summaries.");
      return candidate.publishWorkspaceSummary(summary);
    },
    readWorkspaceSummaries() {
      const candidate = createTransport(transportOptions()) as AuthenticatedHubTransport &
        Partial<HubWorkspaceSummaryTransport>;
      if (typeof candidate.readWorkspaceSummaries !== "function")
        throw new Error("The configured Hub transport does not support workspace summaries.");
      return candidate.readWorkspaceSummaries();
    },
  };
  return {
    idleWait,
    transport,
    workstreamTransport,
    workspaceTransport,
  };
}
