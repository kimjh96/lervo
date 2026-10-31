import type { ProjectStorage } from "@lervo/project-storage";
import { casReferences, type CasRetentionRoots } from "./cas-retention-policy.js";
import type { RetentionScan } from "./cas-retention-state.js";

/** Verified immutable report bodies have no CAS file; cache their references under their digest. */
export async function collectReportReferences(input: {
  storage: ProjectStorage;
  roots: CasRetentionRoots;
  reachable: Set<string>;
  scan: RetentionScan;
  casHashes: ReadonlySet<string>;
  deadline: number;
  shouldYield(): Promise<boolean>;
}): Promise<boolean> {
  const reader = input.storage.events.reports;
  if (!reader) return true;
  const queue = [...input.reachable];
  const visited = new Set<string>();
  let queries = 0;
  let bytes = 0;
  while (queue.length) {
    const hash = queue.pop()!;
    if (visited.has(hash) || input.casHashes.has(hash)) continue;
    visited.add(hash);
    if (visited.size > 200_000)
      throw new Error("CAS report reference inventory exceeds its bound.");
    const referenceSeq = input.roots.lastReference.get(hash) ?? 0;
    let cached = input.scan.reports[hash];
    if (!cached || (cached.references === null && cached.referenceSeq !== referenceSeq)) {
      if (
        queries >= 64 ||
        bytes + 1024 * 1024 > 8 * 1024 * 1024 ||
        Date.now() >= input.deadline ||
        (await input.shouldYield())
      )
        return false;
      const report = reader.getReport(`sha256:${hash}`);
      queries++;
      if (report && report.byteLength > 1024 * 1024)
        throw new Error("CAS report exceeds its byte bound.");
      bytes += report?.byteLength ?? 0;
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
