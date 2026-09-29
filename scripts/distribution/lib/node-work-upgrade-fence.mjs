import { readNodeUpgradeConfigSource } from "./node-upgrade-config-source.mjs";

export class NodeWorkUpgradeFenceError extends Error {
  constructor(code, cause) {
    super(`The Node work upgrade cannot proceed (${code}).`, { cause });
    this.name = "NodeWorkUpgradeFenceError";
    this.code = code;
  }
}

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
    try {
      decision = admission.store.tryFreeze({
        scope: admission.scope,
        configDigest: source.sourceDigest,
      });
    } catch (error) {
      throw new NodeWorkUpgradeFenceError("service_upgrade_fence_invalid", error);
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
