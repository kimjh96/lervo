import type { ConversationAdapter } from "@lervo/conversation-contract";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  supervisionAttentionHealth,
  supervisionAttentionReasonCodes,
  supervisionCycleHealth,
  supervisionCycleFailureLine,
  supervisionEvidenceReadFailureLine,
  supervisionEffectFailureLine,
} from "./supervision-attention-health.js";
import type { NodeRuntimeComponentHealth } from "./health-contract.js";
import { openNodeOutcomeSupervisionRuntime } from "./outcome-supervision-runtime.js";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
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
  /** Last evaluated health for this binding; an idle cycle has reread current authority. */
  let settledHealth: NodeRuntimeComponentHealth | null = null;
  let needsHealthRecovery = false;
  const now = input.now ?? (() => new Date().toISOString());
  const log = input.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const openRuntime = (binding: NodeSupervisionBinding, deferInitialActionUntilChange: boolean) =>
    openNodeOutcomeSupervisionRuntime({
      repositoryRoot: input.repositoryRoot,
      binding,
      requireBoundRequest: true,
      deferInitialActionUntilChange,
      reportEvidenceReadFailure: (error) => log(supervisionEvidenceReadFailureLine(error)),
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
        reportEffectFailure: (plan, error) => log(supervisionEffectFailureLine(plan, error)),
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
  /**
   * One project storage handle for every lineage scan. Opening project storage verifies the whole
   * event chain, so reopening it after each owner cycle re-read and re-hashed the full history.
   */
  let lineageStorage: Promise<ProjectStorage> | null = null;
  let closing = false;
  const openLineageStorage = (): Promise<ProjectStorage> => {
    lineageStorage ??= openProjectStorage(input.repositoryRoot).catch((error: unknown) => {
      lineageStorage = null;
      throw error;
    });
    return lineageStorage;
  };
  const followLineage = async (): Promise<void> => {
    if (!config.standing || closing) return;
    const storage = await openLineageStorage();
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
  };
  const start = (target: typeof runtime) =>
    target.start({
      onFailure: (error) => {
        needsHealthRecovery = true;
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
          // An unchanged cycle reread the source and authority before returning idle.
          if (cycle.disposition === "idle" || cycle.disposition === "blocked") {
            if (settledHealth === null || needsHealthRecovery)
              await observe(settledHealth ?? { status: "pending" });
            needsHealthRecovery = false;
          }
          return;
        }
        const health: NodeRuntimeComponentHealth =
          cycle.disposition === "blocked" || cycle.disposition === "uncertain"
            ? supervisionAttentionHealth(attentionObservation ?? { reasonCodes: null })
            : cycle.report.status === "completed" &&
                cycle.report.reasonCode === "accepted_local_result_available" &&
                cycle.report.nextAction === null
              ? { status: "dormant", reasonCode: "local_result_canonical" }
              : { status: "ready" };
        if (
          cycle.disposition === "blocked" &&
          cycle.report.status === "invalid" &&
          cycle.report.reasonCode === "evidence_unavailable"
        ) {
          // The prior cursor can still be idle after a transient unavailable evidence read.
          // Keep its last valid health for a later successful source and authority reread.
          needsHealthRecovery = true;
          await observe(health);
          return;
        }
        settledHealth = health;
        await observe(health);
        needsHealthRecovery = false;
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
      settledHealth = null;
      needsHealthRecovery = false;
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
      closing = true;
      await switching;
      await runtime.close();
      const storage = await lineageStorage?.catch(() => null);
      lineageStorage = null;
      await storage?.close();
    },
    currentBinding: () => structuredClone(binding),
    rebind,
  };
}
