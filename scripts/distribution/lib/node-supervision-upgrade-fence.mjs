import {
  resolveCurrentStandingUpgradeBinding,
  validStandingUpgradeBinding,
} from "./node-standing-upgrade-binding.mjs";
import { readSupervisionUpgradeCoordinates } from "./node-supervision-upgrade-coordinates.mjs";

export class NodeSupervisionUpgradeFenceError extends Error {
  constructor(code, cause) {
    super(`The supervised Node upgrade cannot proceed (${code}).`, { cause });
    this.name = "NodeSupervisionUpgradeFenceError";
    this.code = code;
  }
}

/** How long an upgrade waits for a running supervision cycle to release its owner lease. */
export const SUPERVISION_BUSY_WAIT_MS = 15 * 60_000;
const SUPERVISION_BUSY_RETRY_MS = 5_000;

async function resolveCurrentBinding(coordinates, resolveStanding) {
  let current;
  try {
    current = coordinates.standing
      ? await resolveStanding(coordinates.repositoryRoot, coordinates.binding)
      : { binding: coordinates.binding, index: 0, nextSupervisionId: null };
  } catch (error) {
    throw new NodeSupervisionUpgradeFenceError("service_upgrade_fence_invalid", error);
  }
  if (coordinates.standing && !validStandingUpgradeBinding(coordinates.binding, current))
    throw new NodeSupervisionUpgradeFenceError(
      "service_upgrade_fence_invalid",
      new Error("The standing supervision binding is invalid."),
    );
  return current;
}

/** Holds the same cross-process owner lock as a supervision cycle until upgrade settles. */
export async function withNodeSupervisionUpgradeFence(input, operation) {
  if (input.runtime !== "node" || !["upgrade", "rollback"].includes(input.action))
    return operation();
  let coordinates;
  try {
    coordinates = await readSupervisionUpgradeCoordinates(input.config);
  } catch (error) {
    throw new NodeSupervisionUpgradeFenceError("service_upgrade_fence_invalid", error);
  }
  if (coordinates === null) return operation(null);
  const openLeases =
    input.openLeases ??
    (async (root) => {
      const { openRepositorySupervisionLeases } =
        await import("../../../packages/agent-workforce/dist/index.js");
      return openRepositorySupervisionLeases(root);
    });
  let leases;
  try {
    leases = await openLeases(coordinates.repositoryRoot);
  } catch (error) {
    throw new NodeSupervisionUpgradeFenceError("service_upgrade_fence_invalid", error);
  }
  try {
    const resolveStanding = input.resolveStanding ?? resolveCurrentStandingUpgradeBinding;
    const sleep =
      input.sleep ?? ((durationMs) => new Promise((done) => setTimeout(done, durationMs)));
    const deadline = Date.now() + (input.busyWaitMs ?? SUPERVISION_BUSY_WAIT_MS);
    // A running supervision cycle holds the owner lease briefly; wait for it to settle instead of
    // failing the upgrade, and give up only when the owner stays busy for the whole bounded wait.
    for (;;) {
      const acquired = [];
      let busy = false;
      try {
        try {
          const current = await resolveCurrentBinding(coordinates, resolveStanding);
          for (const supervisionId of [
            current.nextSupervisionId,
            current.binding.supervisionId,
          ].filter((id) => id !== null)) {
            const lease = leases.acquire({
              supervisionId,
              ownerAgentId: coordinates.binding.ownerAgentId,
              nowMs: Date.now(),
              durationMs: 300_000,
            });
            if (lease === null) {
              busy = true;
              break;
            }
            acquired.push(lease);
          }
          if (!busy && coordinates.standing) {
            const rechecked = await resolveStanding(
              coordinates.repositoryRoot,
              coordinates.binding,
            );
            busy =
              !validStandingUpgradeBinding(coordinates.binding, rechecked) ||
              rechecked.index !== current.index ||
              rechecked.binding.supervisionId !== current.binding.supervisionId ||
              rechecked.nextSupervisionId !== current.nextSupervisionId;
          }
        } catch (error) {
          if (error instanceof NodeSupervisionUpgradeFenceError) throw error;
          throw new NodeSupervisionUpgradeFenceError("service_upgrade_fence_invalid", error);
        }
        if (!busy) return await operation(coordinates);
      } finally {
        for (const lease of acquired.toReversed()) leases.release(lease);
      }
      if (Date.now() >= deadline)
        throw new NodeSupervisionUpgradeFenceError("service_upgrade_supervision_busy");
      await sleep(input.busyRetryMs ?? SUPERVISION_BUSY_RETRY_MS);
    }
  } finally {
    leases.close();
  }
}
