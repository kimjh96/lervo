import type { ConversationAdapter } from "@lervo/conversation-contract";
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
  observeHealth(health: NodeRuntimeComponentHealth): Promise<void>;
  now?(): string;
}): Promise<NodeSupervisionService> {
  const config = parseSupervisionStartupConfiguration(input.configuration);
  if (
    config.resultOrigin !== undefined &&
    input.deliveryAdapter?.descriptor.integrationId !== config.resultOrigin.target.integrationId
  )
    throw new Error("Supervision publication requires its exact configured conversation adapter.");
  let fail!: () => void;
  const failed = new Promise<void>((resolve) => {
    fail = resolve;
  });
  const observe = (health: NodeRuntimeComponentHealth) =>
    input.observeHealth(health).catch(() => {
      fail();
    });
  const runtime = await openNodeOutcomeSupervisionRuntime({
    repositoryRoot: input.repositoryRoot,
    binding: config.binding,
    runtimeReadiness: config.runtimeReadiness,
    ownerReasoning: config.ownerReasoning,
    managedExecution: config.managedExecution,
    ...(config.handoffPeers === undefined ? {} : { handoffPeers: config.handoffPeers }),
    ...(config.resultOrigin === undefined
      ? {}
      : { resultDelivery: { origin: config.resultOrigin, adapter: input.deliveryAdapter! } }),
    ports: {
      now: input.now ?? (() => new Date().toISOString()),
      recordAttention: async () =>
        observe({ status: "unavailable", failureCode: "supervision_attention_required" }),
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
          if (cycle.report === null) return;
          await observe(
            cycle.disposition === "blocked" || cycle.disposition === "uncertain"
              ? { status: "unavailable", failureCode: "supervision_attention_required" }
              : { status: "ready" },
          );
        },
      }),
    close: () => runtime.close(),
  };
}
