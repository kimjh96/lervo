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
  if (coordinates === null) return operation();
  const resolveStanding = input.resolveStanding ?? resolveCurrentStandingUpgradeBinding;
  let current;
  try {
    current = coordinates.standing
      ? await resolveStanding(coordinates.repositoryRoot, coordinates.binding)
      : { binding: coordinates.binding, index: 0, nextSupervisionId: null };
    if (coordinates.standing && !validStandingUpgradeBinding(coordinates.binding, current))
      throw new Error("The standing supervision binding is invalid.");
  } catch (error) {
    throw new NodeSupervisionUpgradeFenceError("service_upgrade_fence_invalid", error);
  }
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
    const acquired = [];
    try {
      try {
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
          if (lease === null)
            throw new NodeSupervisionUpgradeFenceError("service_upgrade_supervision_busy");
          acquired.push(lease);
        }
        if (coordinates.standing) {
          const rechecked = await resolveStanding(coordinates.repositoryRoot, coordinates.binding);
          if (
            !validStandingUpgradeBinding(coordinates.binding, rechecked) ||
            rechecked.index !== current.index ||
            rechecked.binding.supervisionId !== current.binding.supervisionId ||
            rechecked.nextSupervisionId !== current.nextSupervisionId
          )
            throw new NodeSupervisionUpgradeFenceError("service_upgrade_supervision_busy");
        }
      } catch (error) {
        if (error instanceof NodeSupervisionUpgradeFenceError) throw error;
        throw new NodeSupervisionUpgradeFenceError("service_upgrade_fence_invalid", error);
      }
      return await operation();
    } finally {
      for (const lease of acquired.toReversed()) leases.release(lease);
    }
  } finally {
    leases.close();
  }
}
