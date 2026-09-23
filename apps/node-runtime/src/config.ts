import { parseSupervisionStartupConfiguration } from "./supervision-startup-config.js";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

import { readOwnerOnlyText, RuntimeSecurityError } from "@lervo/runtime-security";

import type { NodeRuntimeConfig } from "./config-types.js";
import {
  configRecord,
  configText,
  exactConfigKeys,
  optionalConfigInteger,
} from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";
import { parseRemoteCommandConfig } from "./remote-command-config.js";
import {
  configuredDiscordConversations,
  parseDiscordConversationDeployments,
} from "./discord-conversation-deployments-config.js";

const MAX_CONFIG_BYTES = 1_048_576;
const DESTINATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const WORKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const ORGANIZATION_NODE_PATTERN = /^node_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

function httpsUrl(value: unknown): string {
  const raw = configText(value, "hub.baseUrl");
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new NodeRuntimeError("invalid_config", "hub.baseUrl is invalid.", {
      cause: error,
    });
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "hub.baseUrl must be an HTTPS URL without credentials or a query string.",
    );
  }
  return url.href;
}

export function parseNodeRuntimeConfig(value: unknown, baseDirectory: string): NodeRuntimeConfig {
  const source = configRecord(value, "Node runtime config");
  exactConfigKeys(
    source,
    [
      "outcomeSupervision",
      "schemaVersion",
      "repositoryRoot",
      "hub",
      "sync",
      "organizationCredentials",
      "workspaceCoordination",
      "repositoryReplica",
      "remoteCommands",
      "discordConversation",
      "discordConversations",
    ],
    "Node runtime config",
  );
  if (source.schemaVersion !== 1) {
    throw new NodeRuntimeError("invalid_config", "Node runtime config schemaVersion must be 1.");
  }
  const hub = configRecord(source.hub, "hub");
  exactConfigKeys(hub, ["baseUrl", "bearerTokenFile", "destinationId", "hubIdentityHash"], "hub");
  const destinationId = configText(hub.destinationId, "hub.destinationId");
  const hubIdentityHash = configText(hub.hubIdentityHash, "hub.hubIdentityHash");
  if (!DESTINATION_PATTERN.test(destinationId) || !HASH_PATTERN.test(hubIdentityHash)) {
    throw new NodeRuntimeError("invalid_config", "The Hub destination or identity is invalid.");
  }
  const sync = configRecord(source.sync, "sync");
  exactConfigKeys(
    sync,
    [
      "workerId",
      "idlePollIntervalMs",
      "leaseDurationMs",
      "retryDelayMs",
      "batchLimit",
      "requestTimeoutMs",
      "maxRequestBytes",
      "maxResponseBytes",
    ],
    "sync",
  );
  const workerId = configText(sync.workerId, "sync.workerId");
  if (!WORKER_PATTERN.test(workerId)) {
    throw new NodeRuntimeError("invalid_config", "sync.workerId is invalid.");
  }
  const integer = (key: string, minimum: number, maximum: number) =>
    optionalConfigInteger(sync, key, minimum, maximum, "sync");
  const idlePollIntervalMs = integer("idlePollIntervalMs", 100, 60 * 60_000);
  const leaseDurationMs = integer("leaseDurationMs", 1, 86_400_000);
  const retryDelayMs = integer("retryDelayMs", 1, 86_400_000);
  const batchLimit = integer("batchLimit", 1, 100);
  const requestTimeoutMs = integer("requestTimeoutMs", 10, 300_000);
  const maxRequestBytes = integer("maxRequestBytes", 1_024, 16_777_216);
  const maxResponseBytes = integer("maxResponseBytes", 1_024, 16_777_216);
  const remoteCommands =
    source.remoteCommands === undefined
      ? undefined
      : parseRemoteCommandConfig(source.remoteCommands, baseDirectory);
  const discordDeployments = parseDiscordConversationDeployments({
    legacy: source.discordConversation,
    deployments: source.discordConversations,
    baseDirectory,
  });
  const outcomeSupervision =
    source.outcomeSupervision === undefined
      ? undefined
      : parseSupervisionStartupConfiguration(source.outcomeSupervision);
  for (const discordConversation of configuredDiscordConversations(discordDeployments)) {
    if (
      discordConversation.policy?.acceptsSupervisionGoals === true &&
      (outcomeSupervision === undefined ||
        discordConversation.agentId !== outcomeSupervision.binding.ownerAgentId)
    ) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Discord supervision goal intake requires a matching installed supervision owner binding.",
      );
    }
    if (discordConversation.routing === undefined) continue;
    const hosted = remoteCommands?.providerHost;
    const conversationProviders = [
      ...(discordConversation.routing.intent === undefined
        ? []
        : [discordConversation.routing.intent.provider]),
      discordConversation.routing.response.provider,
      ...(discordConversation.routing.evaluation === undefined
        ? []
        : [discordConversation.routing.evaluation.provider]),
      ...(discordConversation.routing.resultEvaluation === undefined
        ? []
        : [discordConversation.routing.resultEvaluation.provider]),
      discordConversation.command.provider,
    ];
    if (
      hosted !== undefined &&
      conversationProviders.some((provider) => !hosted.providers.includes(provider))
    ) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Discord conversation providers must be allowlisted by the managed provider host.",
      );
    }
  }
  const organizationCredentials =
    source.organizationCredentials === undefined
      ? undefined
      : configRecord(source.organizationCredentials, "organizationCredentials");
  if (organizationCredentials !== undefined) {
    exactConfigKeys(organizationCredentials, ["nodeId"], "organizationCredentials");
    if (
      !ORGANIZATION_NODE_PATTERN.test(
        configText(organizationCredentials.nodeId, "organizationCredentials.nodeId"),
      )
    ) {
      throw new NodeRuntimeError(
        "invalid_config",
        "organizationCredentials must bind a valid organization Node ID.",
      );
    }
  }
  const workspaceCoordination =
    source.workspaceCoordination === undefined
      ? undefined
      : configRecord(source.workspaceCoordination, "workspaceCoordination");
  if (workspaceCoordination !== undefined) {
    exactConfigKeys(workspaceCoordination, ["mode", "nodeId"], "workspaceCoordination");
    if (
      workspaceCoordination.mode !== "hub_coordinated" ||
      !/^nod_[A-Za-z0-9_-]{8,128}$/u.test(
        configText(workspaceCoordination.nodeId, "workspaceCoordination.nodeId"),
      )
    )
      throw new NodeRuntimeError(
        "invalid_config",
        "workspaceCoordination must bind hub_coordinated mode and a valid Node ID.",
      );
  }
  const repositoryReplica =
    source.repositoryReplica === undefined
      ? undefined
      : configRecord(source.repositoryReplica, "repositoryReplica");
  if (repositoryReplica !== undefined) {
    exactConfigKeys(
      repositoryReplica,
      ["required", "maximumStalenessMs", "waitTimeoutMs", "pollIntervalMs"],
      "repositoryReplica",
    );
    if (repositoryReplica.required !== true) {
      throw new NodeRuntimeError(
        "invalid_config",
        "repositoryReplica.required must be true when replica readiness is configured.",
      );
    }
  }
  const replicaInteger = (key: string, minimum: number, maximum: number) =>
    repositoryReplica === undefined
      ? undefined
      : optionalConfigInteger(repositoryReplica, key, minimum, maximum, "repositoryReplica");
  const maximumStalenessMs = replicaInteger("maximumStalenessMs", 1_000, 300_000);
  const replicaWaitTimeoutMs = replicaInteger("waitTimeoutMs", 1_000, 300_000);
  const replicaPollIntervalMs = replicaInteger("pollIntervalMs", 100, 10_000);
  if (
    repositoryReplica !== undefined &&
    (maximumStalenessMs === undefined ||
      replicaWaitTimeoutMs === undefined ||
      replicaPollIntervalMs === undefined)
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "repositoryReplica requires every bounded readiness interval.",
    );
  }
  return {
    schemaVersion: 1,
    ...(outcomeSupervision === undefined ? {} : { outcomeSupervision }),
    repositoryRoot: resolve(baseDirectory, configText(source.repositoryRoot, "repositoryRoot")),
    hub: {
      baseUrl: httpsUrl(hub.baseUrl),
      bearerTokenFile: resolve(
        baseDirectory,
        configText(hub.bearerTokenFile, "hub.bearerTokenFile"),
      ),
      destinationId,
      hubIdentityHash,
    },
    sync: {
      workerId,
      ...(idlePollIntervalMs === undefined ? {} : { idlePollIntervalMs }),
      ...(leaseDurationMs === undefined ? {} : { leaseDurationMs }),
      ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
      ...(batchLimit === undefined ? {} : { batchLimit }),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
      ...(maxRequestBytes === undefined ? {} : { maxRequestBytes }),
      ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
    },
    ...(organizationCredentials === undefined
      ? {}
      : {
          organizationCredentials: {
            nodeId: organizationCredentials.nodeId as string,
          },
        }),
    ...(workspaceCoordination === undefined
      ? {}
      : {
          workspaceCoordination: {
            mode: "hub_coordinated" as const,
            nodeId: workspaceCoordination.nodeId as string,
          },
        }),
    ...(repositoryReplica === undefined
      ? {}
      : {
          repositoryReplica: {
            required: true as const,
            maximumStalenessMs: maximumStalenessMs!,
            waitTimeoutMs: replicaWaitTimeoutMs!,
            pollIntervalMs: replicaPollIntervalMs!,
          },
        }),
    ...(remoteCommands === undefined ? {} : { remoteCommands }),
    ...discordDeployments,
  };
}

export async function loadNodeRuntimeConfigSnapshot(path: string): Promise<{
  config: NodeRuntimeConfig;
  sourceDigest: string;
}> {
  const absolutePath = resolve(path);
  let serialized: string;
  try {
    serialized = await readOwnerOnlyText(absolutePath, MAX_CONFIG_BYTES);
  } catch (error) {
    const code =
      error instanceof RuntimeSecurityError && error.code === "invalid_text"
        ? "invalid_config"
        : "unsafe_runtime_file";
    throw new NodeRuntimeError(code, "Could not read the Node runtime config file safely.", {
      cause: error,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new NodeRuntimeError("invalid_config", "The Node runtime config is not valid JSON.", {
      cause: error,
    });
  }
  return {
    config: parseNodeRuntimeConfig(value, dirname(absolutePath)),
    sourceDigest: `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
  };
}

export async function loadNodeRuntimeConfig(path: string): Promise<NodeRuntimeConfig> {
  return (await loadNodeRuntimeConfigSnapshot(path)).config;
}
