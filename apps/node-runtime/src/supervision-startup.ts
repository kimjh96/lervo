import type { ConversationAdapter } from "@lervo/conversation-contract";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  supervisionAttentionHealth,
  supervisionAttentionReasonCodes,
  supervisionCycleHealth,
  supervisionCycleFailureLine,
} from "./supervision-attention-health.js";
import type { NodeRuntimeComponentHealth } from "./health-contract.js";
import { openNodeOutcomeSupervisionRuntime } from "./outcome-supervision-runtime.js";
import { openProjectStorage } from "@lervo/project-storage";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import {
  resolveStandingSupervisionBinding,
  scanForStandingLineageChange,
} from "./supervision-standing.js";
import { successorId, successorIndexOf } from "@lervo/work-controller";
import {
  parseSupervisionStartupConfiguration,
  type NodeSupervisionStartupConfiguration,
} from "./supervision-startup-config.js";
import { findBoundSupervisionRequestEvent } from "./supervision-request-presence.js";

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
  let attention: {
    reasonCodes: string[];
    resourceBudget?: Parameters<typeof supervisionAttentionHealth>[0]["resourceBudget"];
  } | null = null;
  const now = input.now ?? (() => new Date().toISOString());
  const log = input.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const openRuntime = (binding: NodeSupervisionBinding, deferInitialActionUntilChange: boolean) =>
    openNodeOutcomeSupervisionRuntime({
      repositoryRoot: input.repositoryRoot,
      binding,
      requireBoundRequest: true,
      deferInitialActionUntilChange,
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
        recordAttention: async (report, reasonCodes, details) => {
          attention = {
            reasonCodes: supervisionAttentionReasonCodes(report, reasonCodes),
            ...(details?.resourceBudget === undefined
              ? {}
              : { resourceBudget: structuredClone(details.resourceBudget) }),
          };
          await observe(supervisionAttentionHealth(attention));
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
  const storage = await openProjectStorage(input.repositoryRoot);
  let requestAlreadyBound: boolean;
  try {
    requestAlreadyBound =
      findBoundSupervisionRequestEvent({
        events: storage.events,
        projectId: storage.manifest.projectId,
        binding,
      }) !== null;
  } finally {
    await storage.close();
  }
  let runtime = await openRuntime(binding, requestAlreadyBound);
  let started = false;
  let switching: Promise<void> = Promise.resolve();
  /** The successor identifier one step past the binding the runtime currently follows. */
  const nextSupervisionId = (root: NodeSupervisionBinding, current: NodeSupervisionBinding) =>
    successorId(root.supervisionId, successorIndexOf(current.supervisionId) + 1);
  /** Event sequence already scanned for a lineage installation under the reviewed grant. */
  let scannedSeq = 0;
  const followLineage = async (): Promise<void> => {
    if (!config.standing) return;
    const storage = await openProjectStorage(input.repositoryRoot);
    try {
      const scan = scanForStandingLineageChange(
        storage,
        config.binding,
        [nextSupervisionId(config.binding, binding), binding.supervisionId],
        scannedSeq,
      );
      scannedSeq = scan.seq;
      if (!scan.found) return;
      const resolution = await resolveStandingSupervisionBinding(storage, config.binding, now);
      if (
        resolution.index > successorIndexOf(binding.supervisionId) ||
        resolution.binding.mandateHash !== binding.mandateHash
      )
        void rebind(resolution.binding);
    } finally {
      await storage.close();
    }
  };
  const start = (target: typeof runtime) =>
    target.start({
      onFailure: (error) => {
        const health = supervisionCycleHealth(error);
        if (health.status !== "dormant") log(supervisionCycleFailureLine(error));
        // A settled goal whose successor another process started fails the old owner's cycle.
        void followLineage().catch((followError: unknown) => {
          log(supervisionCycleFailureLine(followError));
        });
        void observe(health);
      },
      onCycle: async (cycle) => {
        const attentionObservation = attention;
        attention = null;
        await followLineage().catch((error: unknown) => {
          log(supervisionCycleFailureLine(error));
        });
        if (cycle.report === null) {
          if (cycle.disposition === "idle") await observe({ status: "ready" });
          return;
        }
        await observe(
          cycle.disposition === "blocked" || cycle.disposition === "uncertain"
            ? supervisionAttentionHealth(attentionObservation ?? { reasonCodes: null })
            : { status: "ready" },
        );
      },
    });
  const rebind = (next: NodeSupervisionBinding): Promise<void> => {
    // Serialize switches: close the owner on the settled goal, then run the successor's owner.
    switching = switching.then(async () => {
      if (!config.standing) throw new Error("Only standing supervision can rebind.");
      if (successorIndexOf(next.supervisionId) < successorIndexOf(binding.supervisionId)) return;
      if (next.supervisionId === binding.supervisionId && next.mandateHash === binding.mandateHash)
        return;
      await runtime.close();
      binding = structuredClone(next);
      runtime = await openRuntime(binding, false);
      void observe({ status: "pending" });
      if (started) start(runtime);
    });
    return switching;
  };
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
    rebind,
  };
}
