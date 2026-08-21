import { resolve } from "node:path";

import {
  DiscordConversationAdapter,
  DiscordRestDelivery,
} from "@lervo/adapter-discord";
import {
  SlackConversationAdapter,
  SlackWebApiDelivery,
} from "@lervo/adapter-slack";
import { FileSystemCas } from "@lervo/cas";
import {
  ConfiguredConversationDeliberationControl,
  QueuedConversationDeliberationBackend,
  reconcileConversationDeliberation,
  runConversationDeliberationResumeWorkerCycle,
  runConversationDeliberationWorkerCycle,
  type ConversationDeliberationReconciliationStore,
} from "@lervo/conversation-control";
import {
  SQLiteConversationDeliberationJobStore,
  SQLiteConversationDeliberationResumeJobStore,
} from "@lervo/conversation-deliberation-sqlite";
import { SQLiteConversationPlatformStore } from "@lervo/conversation-platform-sqlite";

import type { ConversationApplication, ConversationApplicationOptions } from "./types.js";

function uniqueIntegrations(options: ConversationApplicationOptions): void {
  const deployments = [
    ...(options.slack ?? []).map((item) => ({ id: item.integrationId, platform: "slack" as const })),
    ...(options.discord ?? []).map((item) => ({ id: item.integrationId, platform: "discord" as const })),
  ];
  const identifiers = deployments.map((item) => item.id);
  if (identifiers.length === 0 || new Set(identifiers).size !== identifiers.length) {
    throw new Error("Conversation deployment에는 서로 다른 integration이 하나 이상 필요합니다.");
  }
  const configured = new Map(deployments.map((item) => [item.id, item.platform]));
  if ([...options.conversations, ...options.participants, ...(options.threads ?? [])]
    .some((binding) => configured.get(binding.integrationId) !== binding.platform)) {
    throw new Error("Conversation binding이 배포되지 않은 integration을 가리킵니다.");
  }
  for (const deployment of deployments) {
    if (!options.conversations.some((binding) => binding.integrationId === deployment.id) ||
      !options.participants.some((binding) => binding.integrationId === deployment.id)) {
      throw new Error("배포된 conversation integration에는 주소와 participant binding이 필요합니다.");
    }
  }
}

export async function openConversationApplication(
  options: ConversationApplicationOptions,
): Promise<ConversationApplication> {
  uniqueIntegrations(options);
  const artifactStore = await FileSystemCas.open(resolve(options.dataDirectory, "artifacts"));
  const store = await SQLiteConversationPlatformStore.open({
    path: resolve(options.dataDirectory, "platform.sqlite"),
    conversations: options.conversations,
    participants: options.participants,
    ...(options.threads === undefined ? {} : { threads: options.threads }),
  });
  let deliberationStore: SQLiteConversationDeliberationJobStore | null = null;
  let resumeStore: SQLiteConversationDeliberationResumeJobStore | null = null;
  try {
    const deliberationOptions = options.deliberations;
    if (deliberationOptions !== undefined) {
      if (deliberationOptions.bindings.length === 0) {
        throw new Error("Conversation 숙의 배포에는 principal binding이 하나 이상 필요합니다.");
      }
      if (
        deliberationOptions.bindings.some((binding) =>
          binding.permissions.includes("deliberation.resume")) &&
        deliberationOptions.resumeExecutor === undefined
      ) {
        throw new Error("Conversation 숙의 재개 권한에는 resume executor가 필요합니다.");
      }
      deliberationStore = await SQLiteConversationDeliberationJobStore.open({
        path: resolve(options.dataDirectory, "deliberations.sqlite"),
        ...(deliberationOptions.maxRecords === undefined ? {} : {
          maxRecords: deliberationOptions.maxRecords,
        }),
      });
      if (deliberationOptions.resumeExecutor !== undefined) {
        resumeStore = await SQLiteConversationDeliberationResumeJobStore.open({
          path: resolve(options.dataDirectory, "deliberation-resumes.sqlite"),
          ...(deliberationOptions.maxRecords === undefined ? {} : {
            maxRecords: deliberationOptions.maxRecords,
          }),
        });
      }
    }
    const deliberations = deliberationOptions === undefined || deliberationStore === null
      ? null
      : new ConfiguredConversationDeliberationControl({
          backend: new QueuedConversationDeliberationBackend(
            deliberationStore,
            resumeStore ?? undefined,
          ),
          bindings: deliberationOptions.bindings,
        });
    const reconciliation = deliberationOptions?.reconciliationSource === undefined ||
      deliberationStore === null
      ? null
      : {
          source: deliberationOptions.reconciliationSource,
          store: deliberationStore,
        };
    const slackAdapters = new Map((options.slack ?? []).map((deployment) => {
      const delivery = new SlackWebApiDelivery({
        integrationId: deployment.integrationId,
        botToken: deployment.botToken,
        replay: store,
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(deployment.requestTimeoutMs === undefined ? {} : {
          requestTimeoutMs: deployment.requestTimeoutMs,
        }),
        ...(deployment.maxResponseBytes === undefined ? {} : {
          maxResponseBytes: deployment.maxResponseBytes,
        }),
      });
      return [deployment.integrationId, new SlackConversationAdapter({
        integrationId: deployment.integrationId,
        apiAppId: deployment.apiAppId,
        allowedTeamIds: deployment.allowedTeamIds,
        signingSecret: deployment.signingSecret,
        identity: store,
        artifactStore,
        delivery,
        ...(options.now === undefined ? {} : { now: options.now }),
      })] as const;
    }));
    const discordAdapters = new Map((options.discord ?? []).map((deployment) => {
      const delivery = new DiscordRestDelivery({
        integrationId: deployment.integrationId,
        botToken: deployment.botToken,
        replay: store,
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(deployment.requestTimeoutMs === undefined ? {} : {
          requestTimeoutMs: deployment.requestTimeoutMs,
        }),
        ...(deployment.maxResponseBytes === undefined ? {} : {
          maxResponseBytes: deployment.maxResponseBytes,
        }),
      });
      return [deployment.integrationId, new DiscordConversationAdapter({
        integrationId: deployment.integrationId,
        applicationId: deployment.applicationId,
        allowedGuildIds: deployment.allowedGuildIds,
        allowDirectMessages: deployment.allowDirectMessages,
        gatewayAuthentication: deployment.gatewayAuthentication,
        identity: store,
        artifactStore,
        delivery,
        ...(options.now === undefined ? {} : { now: options.now }),
      })] as const;
    }));
    return {
      slackAdapters,
      discordAdapters,
      deliberations,
      runDeliberationWorkerCycle: async () => {
        if (deliberationOptions === undefined || deliberationStore === null) {
          return { status: "idle" };
        }
        return runConversationDeliberationWorkerCycle({
          store: deliberationStore,
          executor: deliberationOptions.executor,
          workerId: deliberationOptions.workerId,
          ...(options.now === undefined ? {} : { now: options.now }),
          ...(deliberationOptions.leaseDurationMs === undefined ? {} : {
            leaseDurationMs: deliberationOptions.leaseDurationMs,
          }),
        });
      },
      runDeliberationResumeWorkerCycle: async () => {
        if (
          deliberationOptions?.resumeExecutor === undefined || resumeStore === null
        ) return { status: "idle" };
        return runConversationDeliberationResumeWorkerCycle({
          store: resumeStore,
          executor: deliberationOptions.resumeExecutor,
          workerId: deliberationOptions.resumeWorkerId ??
            `${deliberationOptions.workerId.slice(0, 120)}:resume`,
          ...(options.now === undefined ? {} : { now: options.now }),
          ...(deliberationOptions.leaseDurationMs === undefined ? {} : {
            leaseDurationMs: deliberationOptions.leaseDurationMs,
          }),
        });
      },
      reconcileDeliberation: reconciliation === null
        ? null
        : async (input) => {
            let store: ConversationDeliberationReconciliationStore = reconciliation.store;
            if (resumeStore !== null && await resumeStore.inspect(input) !== null) {
              store = resumeStore;
            }
            return reconcileConversationDeliberation({
              store,
              source: reconciliation.source,
              projectId: input.projectId,
              deliberationId: input.deliberationId,
              ...(options.now === undefined ? {} : { now: options.now }),
            });
          },
      close: () => {
        resumeStore?.close();
        deliberationStore?.close();
        store.close();
      },
    };
  } catch (error) {
    resumeStore?.close();
    deliberationStore?.close();
    store.close();
    throw error;
  }
}
