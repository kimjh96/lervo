import { readNodeUpgradeConfigSource } from "./node-upgrade-config-source.mjs";

export class NodeWorkUpgradeFenceError extends Error {
  constructor(code, cause, reason) {
    super(
      reason === undefined
        ? `The Node work upgrade cannot proceed (${code}).`
        : `The Node work upgrade cannot proceed (${code}): ${reason}`,
      { cause },
    );
    this.name = "NodeWorkUpgradeFenceError";
    this.code = code;
  }
}

const FREEZE_REFUSALS = {
  active_work: "admitted Node work did not finish within the wait.",
  upgrade_owned: "another upgrade holds this Node's work freeze.",
  session_missing: "no running Node session holds this work scope.",
  session_conflict: "more than one Node session holds this work scope.",
  config_mismatch:
    "the running Node registered a different configuration digest than the file on disk, and no retained ADR-0488 predecessor matches it.",
};

/** How long an upgrade waits for admitted Node work to drain before refusing. */
export const NODE_WORK_BUSY_WAIT_MS = 15 * 60_000;
const NODE_WORK_BUSY_RETRY_MS = 5_000;

async function openNodeAdmission(source, configPath) {
  const { SQLiteNodeWorkAdmission, nodeWorkAdmissionDatabasePath, nodeWorkAdmissionScope } =
    await import("../../../packages/node-work-admission/dist/index.js");
  return {
    store: await SQLiteNodeWorkAdmission.open({
      path: nodeWorkAdmissionDatabasePath(source.repositoryRoot),
    }),
    scope: nodeWorkAdmissionScope(configPath),
  };
}

/** Atomically excludes new Node work and refuses any live admitted operation. */
export async function withNodeWorkUpgradeFence(input, operation) {
  if (input.runtime !== "node" || !["upgrade", "rollback"].includes(input.action))
    return operation();
  let source;
  try {
    source = await readNodeUpgradeConfigSource(input.config);
    if (
      input.expectedSourceDigest !== undefined &&
      source.sourceDigest !== input.expectedSourceDigest
    )
      throw new Error("The installed Node configuration binding changed.");
  } catch (error) {
    throw new NodeWorkUpgradeFenceError("service_upgrade_fence_invalid", error);
  }
  let admission;
  try {
    admission = await (input.openAdmission ?? openNodeAdmission)(source, input.config);
  } catch (error) {
    throw new NodeWorkUpgradeFenceError("service_upgrade_fence_invalid", error);
  }
  try {
    let decision;
    // ADR-0489: a running Node registers the digest of the configuration it read. When the file
    // was migrated in place since then, a retained ADR-0488 predecessor names that digest.
    let freezeDigest = source.sourceDigest;
    let predecessor = null;
    let predecessors = null;
    const sleep =
      input.sleep ?? ((durationMs) => new Promise((done) => setTimeout(done, durationMs)));
    const deadline = Date.now() + (input.busyWaitMs ?? NODE_WORK_BUSY_WAIT_MS);
    // Admitted Node work finishes on its own; wait for it to drain before freezing instead of
    // failing the upgrade. A concurrent upgrade (`upgrade_owned`) is still refused at once.
    for (;;) {
      try {
        let freezeInput = { scope: admission.scope, configDigest: freezeDigest };
        decision = admission.store.tryFreeze(freezeInput);
        if (decision.status === "busy" && decision.reason === "config_mismatch") {
          predecessors ??= (await input.resolveConfigPredecessors?.(source)) ?? [];
          for (const candidate of predecessors) {
            const candidateInput = { ...freezeInput, configDigest: candidate.configDigest };
            const candidateDecision = admission.store.tryFreeze(candidateInput);
            if (
              candidateDecision.status === "busy" &&
              candidateDecision.reason === "config_mismatch"
            )
              continue;
            freezeInput = candidateInput;
            freezeDigest = candidate.configDigest;
            predecessor = candidate;
            decision = candidateDecision;
            break;
          }
        }
        if (
          decision.status === "busy" &&
          decision.reason === "session_missing" &&
          (await input.verifyInactivePredecessor?.()) === true
        )
          decision = admission.store.tryFreeze({ ...freezeInput, allowNoSession: true });
      } catch (error) {
        throw new NodeWorkUpgradeFenceError("service_upgrade_fence_invalid", error);
      }
      if (decision.status === "frozen" || decision.reason !== "active_work") break;
      if (Date.now() >= deadline) break;
      await sleep(input.busyRetryMs ?? NODE_WORK_BUSY_RETRY_MS);
    }
    if (decision.status !== "frozen") {
      throw new NodeWorkUpgradeFenceError(
        ["active_work", "upgrade_owned"].includes(decision.reason)
          ? "service_upgrade_work_busy"
          : decision.reason === "config_mismatch"
            ? "service_upgrade_config_mismatch"
            : "service_upgrade_fence_invalid",
        undefined,
        FREEZE_REFUSALS[decision.reason],
      );
    }
    let operationResult;
    let operationFailure;
    let failed = false;
    try {
      operationResult = await operation({
        replaceConfiguration: (expectedConfigDigest, configDigest) =>
          admission.store.replaceFrozenConfiguration({
            freeze: decision.freeze,
            expectedConfigDigest,
            configDigest,
          }),
        configPredecessor: predecessor,
      });
    } catch (error) {
      operationFailure = error;
      failed = true;
    }
    try {
      if (!admission.store.unfreeze(decision.freeze)) {
        throw new Error("The Node work freeze was lost.");
      }
    } catch (error) {
      throw new NodeWorkUpgradeFenceError("service_upgrade_unknown", error);
    }
    if (failed) throw operationFailure;
    return operationResult;
  } finally {
    admission.store.close();
  }
}
