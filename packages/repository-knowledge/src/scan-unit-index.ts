import type { RepositoryKnowledgeScan, RepositorySourceUnit } from "./types.js";

const indexes = new WeakMap<RepositoryKnowledgeScan, Map<string, RepositorySourceUnit[]>>();

/**
 * Units grouped by source, built once per scan and kept in scan order. Looking units up per
 * source by filtering every unit was quadratic: in large repositories, one normalization
 * inspection kept a resident on a full CPU core.
 */
export function scanUnitsBySource(
  scan: RepositoryKnowledgeScan,
): ReadonlyMap<string, readonly RepositorySourceUnit[]> {
  let index = indexes.get(scan);
  if (index === undefined) {
    index = new Map();
    for (const unit of scan.units) {
      const units = index.get(unit.sourceId);
      if (units === undefined) index.set(unit.sourceId, [unit]);
      else units.push(unit);
    }
    indexes.set(scan, index);
  }
  return index;
}
