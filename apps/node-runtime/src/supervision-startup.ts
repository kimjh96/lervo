import type { ConversationAdapter } from "@lervo/conversation-contract";
import type { ArtifactStore } from "@lervo/storage-contract";
import { supervisionAttentionReasonCodes } from "./supervision-attention-health.js";
import type { NodeRuntimeComponentHealth } from "./health-contract.js";
import { openNodeOutcomeSupervisionRuntime } from "./outcome-supervision-runtime.js";
import {
  parseSupervisionStartupConfiguration,
  type NodeSupervisionStartupConfiguration,
} from "./supervision-startup-config.js";

export interface NodeSupervisionService {
  readonly failed: Promise<void>;
  start(): void;
  close(): Promise<void>;
}

/** Starts one installed owner through the existing durable, serial change loop, with no Hub dependency. */
export async function openNodeSupervisionService(input: {
  repositoryRoot: string;
  configuration: NodeSupervisionStartupConfiguration;
  deliveryAdapter?: ConversationAdapter;
  deliveryArtifacts?: ArtifactStore;
  deliveryReplay?: (
    outboundId: string,
  ) => "absent" | "sending" | "unknown" | "rejected" | "delivered" | null;
  deliverySpeaker?: { participantId: string; roleId: string; conversationIds: readonly string[] };
  observeHealth(health: NodeRuntimeComponentHealth): Promise<void>;
  now?(): string;
}): Promise<NodeSupervisionService> {
  const config = parseSupervisionStartupConfiguration(input.configuration);
  if (
    config.resultOrigin !== undefined &&
    input.deliveryAdapter?.descriptor.integrationId !== config.resultOrigin.target.integrationId
  )
    throw new Error("Supervision publication requires its exact configured conversation adapter.");
  if (config.resultOrigin !== undefined && input.deliveryAdapter === undefined)
    throw new Error("Supervision publication requires its configured conversation adapter.");
  if (
    config.resultOrigin !== undefined &&
    input.deliverySpeaker !== undefined &&
    (config.resultOrigin.actor.participantId !== input.deliverySpeaker.participantId ||
      config.resultOrigin.actor.roleId !== input.deliverySpeaker.roleId ||
      !input.deliverySpeaker.conversationIds.includes(config.resultOrigin.target.conversationId))
  )
    throw new Error("Supervision publication differs from the installed owner speaker.");
  let fail!: () => void;
  const failed = new Promise<void>((resolve) => {
    fail = resolve;
  });
  const observe = (health: NodeRuntimeComponentHealth) =>
    input.observeHealth(health).catch(() => {
      fail();
    });
  /** Codes from the latest attention in the current cycle; the cycle observation carries them. */
  let attention: string[] | null = null;
  const attentionHealth = (reasonCodes: string[] | null): NodeRuntimeComponentHealth => ({
    status: "unavailable",
    failureCode: "supervision_attention_required",
    ...(reasonCodes === null ? {} : { reasonCodes: [...reasonCodes] }),
  });
  const runtime = await openNodeOutcomeSupervisionRuntime({
    repositoryRoot: input.repositoryRoot,
    binding: config.binding,
    runtimeReadiness: config.runtimeReadiness,
    ownerReasoning: config.ownerReasoning,
    managedExecution: config.managedExecution,
    ...(config.handoffPeers === undefined ? {} : { handoffPeers: config.handoffPeers }),
    ...(input.deliveryAdapter === undefined
      ? {}
      : {
          resultDelivery: {
            ...(config.resultOrigin === undefined ? {} : { origin: config.resultOrigin }),
            ...(input.deliverySpeaker === undefined ? {} : { speaker: input.deliverySpeaker }),
            adapter: input.deliveryAdapter,
            ...(input.deliveryArtifacts === undefined
              ? {}
              : { adapterArtifacts: input.deliveryArtifacts }),
            ...(input.deliveryReplay === undefined ? {} : { replayStatus: input.deliveryReplay }),
          },
        }),
    ports: {
      now: input.now ?? (() => new Date().toISOString()),
      recordAttention: async (report, reasonCodes) => {
        attention = supervisionAttentionReasonCodes(report, reasonCodes);
        await observe(attentionHealth(attention));
      },
    },
  });
  return {
    failed,
    start: () =>
      runtime.start({
        onFailure: () => {
          void observe({ status: "unavailable", failureCode: "supervision_cycle_failed" });
        },
        onCycle: async (cycle) => {
          const reasonCodes = attention;
          attention = null;
          if (cycle.report === null) return;
          await observe(
            cycle.disposition === "blocked" || cycle.disposition === "uncertain"
              ? attentionHealth(reasonCodes)
              : { status: "ready" },
          );
        },
      }),
    close: () => runtime.close(),
  };
}
