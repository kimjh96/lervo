import { canonicalJson } from "@lervo/event-contract";

import { roleSha256 } from "./integrity.js";
import type { ResolvedRoleContract } from "./types.js";

const MAXIMUM_REGISTRIES = 16;

/**
 * ADR-0491: resolving the role registry builds, validates, and hashes every built-in definition
 * and every repository composition. A resident Node resolved it on each assignment check and spent
 * about a tenth of a core on it. Resolution is a pure function of the exact repository role
 * sources, so results are memoized by their canonical digest and handed out as private clones.
 */
const registries = new Map<string, ResolvedRoleContract[]>();

export function memoizedRoleRegistry(
  sources: ReadonlyMap<string, { source: unknown; path: string }>,
  resolve: () => ResolvedRoleContract[],
): ResolvedRoleContract[] {
  const key = roleSha256(
    canonicalJson(
      [...sources]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([roleId, entry]) => [roleId, entry.path, entry.source]),
    ),
  );
  let registry = registries.get(key);
  if (registry === undefined) {
    registry = resolve();
    if (registries.size >= MAXIMUM_REGISTRIES)
      registries.delete(registries.keys().next().value as string);
    registries.set(key, registry);
  }
  return registry.map((contract) => structuredClone(contract));
}
