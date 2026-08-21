import { resolve } from "node:path";

import { DiscordConversationAdapter } from "@lervo/adapter-discord";
import { SlackConversationAdapter } from "@lervo/adapter-slack";
import { FileSystemCas } from "@lervo/cas";
import {
  assertConversationAdapterDescriptor,
  type ConversationAdapter,
} from "@lervo/conversation-contract";
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

import { configuredConversationIntegrations } from "./built-in-integrations.js";
import type { ConversationApplication, ConversationApplicationOptions } from "./types.js";

function uniqueIntegrations(
  options: ConversationApplicationOptions,
  deployments: ReturnType<typeof configuredConversationIntegrations>,
): void {
  const identifiers = deployments.map((item) => item.integrationId);
  if (identifiers.length === 0 || new Set(identifiers).size !== identifiers.length) {
    throw new Error("Conversation deployment에는 서로 다른 integration이 하나 이상 필요합니다.");
  }
  const configured = new Map(deployments.map((item) => [item.integrationId, item.platform]));
  if ([...options.conversations, ...options.participants, ...(options.threads ?? [])]
    .some((binding) => configured.get(binding.integrationId) !== binding.platform)) {
    throw new Error("Conversation binding이 배포되지 않은 integration을 가리킵니다.");
  }
  for (const deployment of deployments) {
    if (deployment.platform !== null && (
      !options.conversations.some((binding) => binding.integrationId === deployment.integrationId) ||
      !options.participants.some((binding) => binding.integrationId === deployment.integrationId)
    )) {
      throw new Error("배포된 conversation integration에는 주소와 participant binding이 필요합니다.");
    }
  }
}

export async function openConversationApplication(
  options: ConversationApplicationOptions,
): Promise<ConversationApplication> {
  const integrationDeployments = configuredConversationIntegrations(options);
  uniqueIntegrations(options, integrationDeployments);
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
    const adapters = new Map<string, ConversationAdapter>();
    for (const deployment of integrationDeployments) {
      const adapter = await deployment.create({
        artifactStore,
        identity: store,
        deliveryReplay: store,
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      });
      assertConversationAdapterDescriptor(adapter.descriptor);
      if (
        adapter.descriptor.integrationId !== deployment.integrationId ||
        (deployment.platform !== null &&
          adapter.descriptor.adapterKind !== deployment.platform)
      ) {
        throw new Error("Conversation adapter descriptor가 deployment 좌표와 다릅니다.");
      }
      adapters.set(deployment.integrationId, adapter);
    }
    const slackAdapters = new Map([...adapters].filter(
      (entry): entry is [string, SlackConversationAdapter] =>
        entry[1] instanceof SlackConversationAdapter,
    ));
    const discordAdapters = new Map([...adapters].filter(
      (entry): entry is [string, DiscordConversationAdapter] =>
        entry[1] instanceof DiscordConversationAdapter,
    ));
    return {
      adapters,
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
