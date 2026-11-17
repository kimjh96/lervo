import type { ProjectStorage } from "@lervo/project-storage";
import type { ReferenceReadBudget } from "./cas-retention-budget.js";
import { CasRetentionBoundError } from "./cas-retention-errors.js";
import type { CasRetentionRoots } from "./cas-retention-policy.js";
import { casReferences } from "./cas-retention-references.js";
import type { RetentionScan } from "./cas-retention-state.js";

const MAXIMUM_REPORT_BYTES = 1024 * 1024;

/** Verified immutable report bodies have no CAS file; cache their references under their digest. */
export async function collectReportReferences(input: {
  storage: ProjectStorage;
  roots: CasRetentionRoots;
  reachable: Set<string>;
  scan: RetentionScan;
  casHashes: ReadonlySet<string>;
  /** Its own cycle budget: body scanning never spends the report lookups' time (ADR-0584). */
  budget: ReferenceReadBudget;
}): Promise<boolean> {
  const reader = input.storage.events.reports;
  if (!reader) return true;
  const queue = [...input.reachable];
  const visited = new Set<string>();
  while (queue.length) {
    const hash = queue.pop()!;
    if (visited.has(hash) || input.casHashes.has(hash)) continue;
    visited.add(hash);
    if (visited.size > 200_000)
      throw new CasRetentionBoundError("CAS report reference inventory exceeds its bound.");
    const referenceSeq = input.roots.lastReference.get(hash) ?? 0;
    let cached = input.scan.reports[hash];
    if (!cached || (cached.references === null && cached.referenceSeq !== referenceSeq)) {
      if (await input.budget.exhausted(MAXIMUM_REPORT_BYTES)) return false;
      const report = await input.budget.read(
        async () => reader.getReport(`sha256:${hash}`),
        (body) => body?.byteLength ?? 0,
      );
      if (report && report.byteLength > MAXIMUM_REPORT_BYTES)
        throw new CasRetentionBoundError("CAS report exceeds its byte bound.");
      cached = {
        referenceSeq,
        references: report ? casReferences(Buffer.from(report).toString("latin1")) : null,
      };
      input.scan.reports[hash] = cached;
    }
    for (const reference of cached.references ?? []) {
      input.reachable.add(reference);
      queue.push(reference);
    }
  }
  return true;
}
