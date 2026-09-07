import { resolve } from "node:path";

import type { ProjectManifest } from "@lervo/schemas";

import type { NodeRuntimeConfig } from "./config-types.js";
import {
  openNodeDiscordConversationRuntime,
  type NodeDiscordConversationRuntime,
} from "./discord-conversation-runtime.js";
import { NodeRuntimeError } from "./errors.js";
import type { NodeRuntimeOpenPorts } from "./open-ports.js";

export async function openDeploymentConversation(input: {
  config: NodeRuntimeConfig;
  project: ProjectManifest;
  projectIdentityHash: string;
  repositoryRoot: string;
  dataDirectory: string;
  bearerToken(): string;
  ports: NodeRuntimeOpenPorts["discordConversation"];
  onReady(): void | Promise<void>;
  onFailure(code: string): void | Promise<void>;
}): Promise<NodeDiscordConversationRuntime | undefined> {
  const conversation = input.config.discordConversation;
  if (conversation === undefined) {
    if (input.ports !== undefined) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Discord conversation ports require Discord conversation configuration.",
      );
    }
    return undefined;
  }
  const providerExecutables = input.config.remoteCommands?.providerHost?.executables;
  return openNodeDiscordConversationRuntime({
    config: conversation,
    hub: input.config.hub,
    project: {
      projectId: input.project.projectId,
      projectIdentityHash: input.projectIdentityHash,
      createdAt: input.project.createdAt,
    },
    repositoryRoot: input.repositoryRoot,
    dataDirectory: resolve(input.dataDirectory, "conversation", conversation.integrationId),
    bearerToken: input.bearerToken,
    ...(providerExecutables === undefined ? {} : { providerExecutables }),
    ...input.ports,
    onReady: input.onReady,
    onFailure: input.onFailure,
  });
}
