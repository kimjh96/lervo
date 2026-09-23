import { watchConversationQueueChanges } from "./queue-change-notifications.js";
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
import { ConversationDiscordDeploymentRuntime } from "./discord-deployment-runtime.js";
import { ConversationInteractionRuntime } from "./interaction-runtime.js";
import { ConversationOperationDrain } from "./operation-drain.js";
import type { ConversationApplication, ConversationApplicationOptions } from "./types.js";

function uniqueIntegrations(
  options: ConversationApplicationOptions,
  deployments: ReturnType<typeof configuredConversationIntegrations>,
): void {
  const identifiers = deployments.map((item) => item.integrationId);
  if (identifiers.length === 0 || new Set(identifiers).size !== identifiers.length) {
    throw new Error("A conversation deployment requires at least one unique integration.");
  }
  const configured = new Map(deployments.map((item) => [item.integrationId, item.platform]));
  if (
    [...options.conversations, ...options.participants, ...(options.threads ?? [])].some(
      (binding) => configured.get(binding.integrationId) !== binding.platform,
    )
  ) {
    throw new Error("A conversation binding references an integration that is not deployed.");
  }
  for (const deployment of deployments) {
    if (
      deployment.platform !== null &&
      (!options.conversations.some(
        (binding) => binding.integrationId === deployment.integrationId,
      ) ||
        !options.participants.some((binding) => binding.integrationId === deployment.integrationId))
    ) {
      throw new Error(
        "Each deployed conversation integration requires address and participant bindings.",
      );
    }
  }
}

export async function openConversationApplication(
  options: ConversationApplicationOptions,
): Promise<ConversationApplication> {
  let interactions: ConversationInteractionRuntime | null = null;
  let adapters = new Map<string, ConversationAdapter>();
  const operations = options.operationDrain ?? new ConversationOperationDrain();
  const discordRuntime = new ConversationDiscordDeploymentRuntime(options, operations);
  if (discordRuntime.gateways.size > 0 && options.interactions === undefined) {
    throw new Error("A managed Discord Gateway requires a conversation interaction deployment.");
  }
  const integrationDeployments = configuredConversationIntegrations(
    options,
    discordRuntime.authentications,
  );
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
    if (options.interactions !== undefined) {
      interactions = await ConversationInteractionRuntime.open({
        dataDirectory: options.dataDirectory,
        deployment: options.interactions,
      });
    }
    const deliberationOptions = options.deliberations;
    if (deliberationOptions !== undefined) {
      if (deliberationOptions.bindings.length === 0) {
        throw new Error(
          "A conversation deliberation deployment requires at least one principal binding.",
        );
      }
      if (
        deliberationOptions.bindings.some((binding) =>
          binding.permissions.includes("deliberation.resume"),
        ) &&
        deliberationOptions.resumeExecutor === undefined
      ) {
        throw new Error("Conversation deliberation resume permission requires a resume executor.");
      }
      deliberationStore = await SQLiteConversationDeliberationJobStore.open({
        path: resolve(options.dataDirectory, "deliberations.sqlite"),
        ...(deliberationOptions.maxRecords === undefined
          ? {}
          : {
              maxRecords: deliberationOptions.maxRecords,
            }),
      });
      if (deliberationOptions.resumeExecutor !== undefined) {
        resumeStore = await SQLiteConversationDeliberationResumeJobStore.open({
          path: resolve(options.dataDirectory, "deliberation-resumes.sqlite"),
          ...(deliberationOptions.maxRecords === undefined
            ? {}
            : {
                maxRecords: deliberationOptions.maxRecords,
              }),
        });
      }
    }
    const deliberations =
      deliberationOptions === undefined || deliberationStore === null
        ? null
        : new ConfiguredConversationDeliberationControl({
            backend: new QueuedConversationDeliberationBackend(
              deliberationStore,
              resumeStore ?? undefined,
            ),
            bindings: deliberationOptions.bindings,
          });
    const trackedDeliberations =
      deliberations === null
        ? null
        : {
            start: (input: Parameters<typeof deliberations.start>[0]) =>
              operations.run(() => deliberations.start(input)),
            resume: (input: Parameters<typeof deliberations.resume>[0]) =>
              operations.run(() => deliberations.resume(input)),
            inspect: (input: Parameters<typeof deliberations.inspect>[0]) =>
              operations.run(() => deliberations.inspect(input)),
          };
    const reconciliation =
      deliberationOptions?.reconciliationSource === undefined || deliberationStore === null
        ? null
        : {
            source: deliberationOptions.reconciliationSource,
            store: deliberationStore,
          };
    adapters = new Map<string, ConversationAdapter>();
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
        (deployment.platform !== null && adapter.descriptor.adapterKind !== deployment.platform)
      ) {
        throw new Error(
          "The conversation adapter descriptor does not match deployment coordinates.",
        );
      }
      adapters.set(deployment.integrationId, adapter);
    }
    const slackAdapters = new Map(
      [...adapters].filter(
        (entry): entry is [string, SlackConversationAdapter] =>
          entry[1] instanceof SlackConversationAdapter,
      ),
    );
    const discordAdapters = new Map(
      [...adapters].filter(
        (entry): entry is [string, DiscordConversationAdapter] =>
          entry[1] instanceof DiscordConversationAdapter,
      ),
    );
    if (interactions !== null) {
      discordRuntime.attach({ adapters: discordAdapters, interactions, store });
    }
    discordRuntime.start();
    const inspectDeliberationOrigin = async (input: {
      projectId: string;
      deliberationId: string;
    }) => {
      if (deliberationStore === null) return null;
      const job = await deliberationStore.inspect(input);
      if (job?.origin === null || job === null) return null;
      return {
        sourceEventId: job.sourceEventId,
        responseLanguage: /\p{Script=Hangul}/u.test(job.topic) ? ("ko" as const) : ("en" as const),
        ...structuredClone(job.origin),
      };
    };
    return {
      inspectDeliveryReplay: (input) => store.inspectDeliveryReplay(input),
      nextInteractionWakeupAt: (integrationId) => interactions?.nextWakeupAt(integrationId) ?? null,
      nextDeliberationWakeupAt: () => {
        const deadlines = [deliberationStore?.nextWakeupAt(), resumeStore?.nextWakeupAt()].filter(
          (at): at is number => typeof at === "number",
        );
        return deadlines.length === 0 ? null : Math.min(...deadlines);
      },
      subscribeChanges: (kind, notify) =>
        watchConversationQueueChanges(options.dataDirectory, kind, notify),
      adapters,
      slackAdapters,
      discordAdapters,
      discordGateways: discordRuntime.gateways,
      deliberations: trackedDeliberations,
      inspectDeliberationOrigin: (input) => operations.run(() => inspectDeliberationOrigin(input)),
      claimDeliberationNotification: () =>
        operations.run(async () => {
          if (deliberationStore === null || deliberationOptions === undefined) return null;
          const claimedAt = (options.now?.() ?? new Date()).toISOString();
          const leaseDurationMs = deliberationOptions.leaseDurationMs ?? 5 * 60_000;
          const notification =
            (await deliberationStore.claimNotification({
              workerId: `${deliberationOptions.workerId.slice(0, 114)}:notification`,
              claimedAt,
              leaseDurationMs,
            })) ??
            (resumeStore === null
              ? null
              : await resumeStore.claimNotification({
                  workerId: `${deliberationOptions.workerId.slice(0, 107)}:resume:notification`,
                  claimedAt,
                  leaseDurationMs,
                }));
          if (notification === null) return null;
          return {
            ...notification,
            origin: await inspectDeliberationOrigin(notification.notification),
          };
        }),
      acceptDeliberationNotification: (input) =>
        operations.run(async () => {
          const store = input.operation === "start" ? deliberationStore : resumeStore;
          if (store === null) {
            throw new Error("The deliberation notification store is not configured.");
          }
          await store.acceptNotification({
            deliberationId: input.deliberationId,
            leaseId: input.leaseId,
            conversationEventId: input.conversationEventId,
            acceptedAt: (options.now?.() ?? new Date()).toISOString(),
          });
        }),
      listUncertainDeliberations: (input) =>
        operations.run(async () => {
          if (deliberationStore === null) return [];
          const start = await deliberationStore.listUncertain(input);
          if (resumeStore === null || start.length >= input.limit) return start;
          const resume = await resumeStore.listUncertain({
            ...input,
            limit: input.limit - start.length,
          });
          return [
            ...new Map([...start, ...resume].map((item) => [item.deliberationId, item])).values(),
          ]
            .toSorted((left, right) =>
              left.uncertainAt === right.uncertainAt
                ? left.deliberationId.localeCompare(right.deliberationId)
                : left.uncertainAt.localeCompare(right.uncertainAt),
            )
            .slice(0, input.limit);
        }),
      hasConversationSourceEventKeyHash: (sourceEventKeyHash) =>
        interactions?.hasSourceEventKeyHash(sourceEventKeyHash) ?? false,
      handleInboundEvent:
        interactions === null ? null : (event) => operations.run(() => interactions!.handle(event)),
      runDeliveryCycle:
        interactions === null
          ? null
          : (integrationId) =>
              operations.run(async () => {
                const adapter = adapters.get(integrationId);
                if (adapter === undefined) {
                  throw new Error("The conversation delivery integration is not deployed.");
                }
                return interactions!.runDeliveryCycle(adapter);
              }),
      runInteractionRetryCycle:
        interactions === null
          ? null
          : (integrationId) =>
              operations.run(async () => {
                const adapter = adapters.get(integrationId);
                if (adapter === undefined) {
                  throw new Error("The conversation retry integration is not deployed.");
                }
                const result = await interactions!.runRetryCycle(integrationId);
                await interactions!.runDeliveryCycle(adapter);
                return result;
              }),
      runDeliberationWorkerCycle: () =>
        operations.run(async () => {
          if (deliberationOptions === undefined || deliberationStore === null) {
            return { status: "idle" };
          }
          return runConversationDeliberationWorkerCycle({
            store: deliberationStore,
            executor: deliberationOptions.executor,
            workerId: deliberationOptions.workerId,
            ...(options.now === undefined ? {} : { now: options.now }),
            ...(deliberationOptions.leaseDurationMs === undefined
              ? {}
              : {
                  leaseDurationMs: deliberationOptions.leaseDurationMs,
                }),
          });
        }),
      runDeliberationResumeWorkerCycle: () =>
        operations.run(async () => {
          if (deliberationOptions?.resumeExecutor === undefined || resumeStore === null)
            return { status: "idle" };
          return runConversationDeliberationResumeWorkerCycle({
            store: resumeStore,
            executor: deliberationOptions.resumeExecutor,
            workerId:
              deliberationOptions.resumeWorkerId ??
              `${deliberationOptions.workerId.slice(0, 120)}:resume`,
            ...(options.now === undefined ? {} : { now: options.now }),
            ...(deliberationOptions.leaseDurationMs === undefined
              ? {}
              : {
                  leaseDurationMs: deliberationOptions.leaseDurationMs,
                }),
          });
        }),
      reconcileDeliberation:
        reconciliation === null
          ? null
          : (input) =>
              operations.run(async () => {
                let store: ConversationDeliberationReconciliationStore = reconciliation.store;
                if (resumeStore !== null && (await resumeStore.inspect(input)) !== null) {
                  store = resumeStore;
                }
                return reconcileConversationDeliberation({
                  store,
                  source: reconciliation.source,
                  projectId: input.projectId,
                  deliberationId: input.deliberationId,
                  ...(options.now === undefined ? {} : { now: options.now }),
                });
              }),
      stopIngress: () => {
        operations.stop();
        discordRuntime.stop();
      },
      close: () => {
        operations.stop();
        discordRuntime.stop();
        const closeStores = () => {
          interactions?.close();
          resumeStore?.close();
          deliberationStore?.close();
          store.close();
        };
        if (operations.activeCount === 0) {
          closeStores();
          return Promise.resolve();
        }
        return operations.drain().then(closeStores);
      },
    };
  } catch (error) {
    operations.stop();
    discordRuntime.stop();
    await operations.drain();
    interactions?.close();
    resumeStore?.close();
    deliberationStore?.close();
    store.close();
    throw error;
  }
}
