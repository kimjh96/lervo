import { readNodeUpgradeConfigSource } from "./node-upgrade-config-source.mjs";

export class NodeWorkUpgradeFenceError extends Error {
  constructor(code, cause) {
    super(`The Node work upgrade cannot proceed (${code}).`, { cause });
    this.name = "NodeWorkUpgradeFenceError";
    this.code = code;
  }
}

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
    const sleep =
      input.sleep ?? ((durationMs) => new Promise((done) => setTimeout(done, durationMs)));
    const deadline = Date.now() + (input.busyWaitMs ?? NODE_WORK_BUSY_WAIT_MS);
    // Admitted Node work finishes on its own; wait for it to drain before freezing instead of
    // failing the upgrade. A concurrent upgrade (`upgrade_owned`) is still refused at once.
    for (;;) {
      try {
        const freezeInput = {
          scope: admission.scope,
          configDigest: source.sourceDigest,
        };
        decision = admission.store.tryFreeze(freezeInput);
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
          : "service_upgrade_fence_invalid",
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
