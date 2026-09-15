import type { ConversationAdapter } from "@lervo/conversation-contract";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  supervisionAttentionReasonCodes,
  supervisionCycleFailureCode,
  supervisionCycleFailureLine,
} from "./supervision-attention-health.js";
import type { NodeRuntimeComponentHealth } from "./health-contract.js";
import { openNodeOutcomeSupervisionRuntime } from "./outcome-supervision-runtime.js";
import { openProjectStorage } from "@lervo/project-storage";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { resolveStandingSupervisionBinding } from "./supervision-standing.js";
import {
  parseSupervisionStartupConfiguration,
  type NodeSupervisionStartupConfiguration,
} from "./supervision-startup-config.js";

export interface NodeSupervisionService {
  readonly failed: Promise<void>;
  start(): void;
  close(): Promise<void>;
  /** Standing supervision: follow the next lineage binding a successor transition installed. */
  rebind(binding: NodeSupervisionBinding): Promise<void>;
  /** The binding the running owner currently follows. */
  currentBinding(): NodeSupervisionBinding;
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
  /** Receives one bounded line per failed owner cycle; defaults to the process error stream. */
  log?(line: string): void;
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
  const now = input.now ?? (() => new Date().toISOString());
  const log = input.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const openRuntime = (binding: NodeSupervisionBinding) =>
    openNodeOutcomeSupervisionRuntime({
      repositoryRoot: input.repositoryRoot,
      binding,
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
        now,
        recordAttention: async (report, reasonCodes) => {
          attention = supervisionAttentionReasonCodes(report, reasonCodes);
          await observe(attentionHealth(attention));
        },
      },
    });
  const resolveBinding = async (): Promise<NodeSupervisionBinding> => {
    if (!config.standing) return config.binding;
    const storage = await openProjectStorage(input.repositoryRoot);
    try {
      return (await resolveStandingSupervisionBinding(storage, config.binding, now)).binding;
    } finally {
      await storage.close();
    }
  };
  let binding = await resolveBinding();
  let runtime = await openRuntime(binding);
  let started = false;
  let switching: Promise<void> = Promise.resolve();
  const start = (target: typeof runtime) =>
    target.start({
      onFailure: (error) => {
        log(supervisionCycleFailureLine(error));
        void observe({
          status: "unavailable",
          failureCode: "supervision_cycle_failed",
          reasonCodes: [supervisionCycleFailureCode(error)],
        });
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
    });
  return {
    failed,
    start: () => {
      started = true;
      start(runtime);
    },
    close: async () => {
      await switching;
      await runtime.close();
    },
    currentBinding: () => structuredClone(binding),
    rebind: (next) => {
      // Serialize switches: close the owner on the settled goal, then run the successor's owner.
      switching = switching.then(async () => {
        if (!config.standing) throw new Error("Only standing supervision can rebind.");
        if (next.supervisionId === binding.supervisionId) return;
        await runtime.close();
        binding = structuredClone(next);
        runtime = await openRuntime(binding);
        void observe({ status: "pending" });
        if (started) start(runtime);
      });
      return switching;
    },
  };
}
