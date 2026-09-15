import { resolve } from "node:path";

import {
  DiscordOrganizationExecutiveEffectAdapter,
  DiscordRestAdministration,
} from "@lervo/adapter-discord";
import type {
  CeoCommandRequest,
  CeoPolicy,
  OrganizationExecutiveEffect,
} from "@lervo/application-contract";
import {
  configuredDiscordConversations,
  loadDiscordBotToken,
  loadNodeRuntimeConfig,
} from "@lervo/node-runtime";
import { openProjectStorage } from "@lervo/project-storage";
import { executeOrganizationExecutiveCommand } from "@lervo/work-controller";

import { readOrganizationCommandJson } from "./ceo-command.js";
import { inspectOrganizationPortfolio } from "./organization-portfolio-command.js";
import { SQLiteOrganizationExecutiveEffectReplay } from "./organization-executive-replay.js";
import type { CliIo } from "./types.js";
import { DiscordWebhookCredentialFileSink } from "./discord-webhook-credential-sink.js";
import { RepositoryOrganizationExecutiveEffectAdapter } from "./repository-organization-executive-effects.js";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The organization executive effect parameters are invalid.");
  }
  return value as Record<string, unknown>;
}

export async function runOrganizationExecutiveCommand(input: {
  io: CliIo;
  root: string;
  organizationId: string;
  teamRoots: readonly string[];
  policyPath: string;
  requestPath: string;
  effectPath: string;
  configPath: string | undefined;
  json: boolean | undefined;
}): Promise<number> {
  const [policy, request, effect, organization] = await Promise.all([
    readOrganizationCommandJson(resolve(input.io.cwd, input.policyPath), "The executive policy"),
    readOrganizationCommandJson(resolve(input.io.cwd, input.requestPath), "The executive request"),
    readOrganizationCommandJson(resolve(input.io.cwd, input.effectPath), "The executive effect"),
    inspectOrganizationPortfolio({
      cwd: input.io.cwd,
      organizationId: input.organizationId,
      teamRoots: input.teamRoots,
    }),
  ]);
  const typedEffect = effect as OrganizationExecutiveEffect;
  const adapter =
    typedEffect.adapterId === "repository_organization_v1"
      ? new RepositoryOrganizationExecutiveEffectAdapter({
          cwd: input.io.cwd,
          allowedRepositoryRoots: input.teamRoots,
        })
      : await discordExecutiveAdapter({
          cwd: input.io.cwd,
          configPath: input.configPath,
          effect: typedEffect,
        });
  const storage = await openProjectStorage(input.root);
  const replayPath = resolve(storage.paths.state, "organization-executive-effects.sqlite");
  await storage.close();
  const replay = await SQLiteOrganizationExecutiveEffectReplay.open(replayPath);
  try {
    const result = await executeOrganizationExecutiveCommand({
      policy: policy as CeoPolicy,
      request: request as CeoCommandRequest,
      organization,
      effect: typedEffect,
      adapter,
      replay,
    });
    input.io.stdout(
      input.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : result.status === "completed" || result.status === "replayed"
          ? "The approved organization action completed and its receipt was recorded.\n"
          : result.status === "uncertain"
            ? "The organization action outcome is uncertain. It was not retried.\n"
            : "The organization action was not performed.\n",
    );
    return result.status === "completed" || result.status === "replayed" ? 0 : 2;
  } finally {
    replay.close();
  }
}

async function discordExecutiveAdapter(input: {
  cwd: string;
  configPath: string | undefined;
  effect: OrganizationExecutiveEffect;
}): Promise<DiscordOrganizationExecutiveEffectAdapter> {
  if (input.configPath === undefined) {
    throw new Error("Discord executive effects require a deployment config.");
  }
  const config = await loadNodeRuntimeConfig(resolve(input.cwd, input.configPath));
  const parameters = record(input.effect.parameters);
  const integrationId = String(parameters.integrationId);
  const deployment = configuredDiscordConversations(config).find(
    (candidate) => candidate.integrationId === integrationId,
  );
  if (deployment === undefined)
    throw new Error("The executive effect integration is not deployed.");
  const requiredAction =
    input.effect.action === "conversation.channel.create"
      ? "guild_text_channel.create"
      : input.effect.action === "conversation.thread.create"
        ? "public_thread.create"
        : input.effect.action === "agent.deployment.prepare"
          ? "incoming_webhook.create"
          : null;
  if (
    requiredAction === null ||
    !deployment.administration?.allowedActions.includes(requiredAction)
  ) {
    throw new Error("The executive effect is not allowlisted by the deployed adapter.");
  }
  const token = await loadDiscordBotToken(deployment.botTokenFile);
  return new DiscordOrganizationExecutiveEffectAdapter(
    new DiscordRestAdministration({
      applicationId: deployment.applicationId,
      botToken: token,
      allowedGuildIds: deployment.allowedGuildIds,
      allowedChannelIds: deployment.conversations.map((item) => item.conversationKey),
      ...(deployment.http?.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: deployment.http.requestTimeoutMs }),
      ...(deployment.http?.maxResponseBytes === undefined
        ? {}
        : { maxResponseBytes: deployment.http.maxResponseBytes }),
    }),
    deployment.administration?.webhookCredentialDirectory === undefined
      ? undefined
      : new DiscordWebhookCredentialFileSink(deployment.administration.webhookCredentialDirectory),
  );
}
