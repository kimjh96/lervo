import { describe, expect, it } from "vitest";

import { scanUnitsBySource } from "../src/scan-unit-index.js";
import type { RepositoryKnowledgeScan, RepositorySourceUnit } from "../src/types.js";

const unit = (sourceId: string, index: number) =>
  ({ sourceId, unitVersionId: `${sourceId}:${index}` }) as unknown as RepositorySourceUnit;

describe("scan units by source", () => {
  it("groups units by source in scan order and reuses the index for the same scan", () => {
    const units = [unit("a", 0), unit("b", 0), unit("a", 1), unit("c", 0), unit("a", 2)];
    const scan = { units } as unknown as RepositoryKnowledgeScan;
    const index = scanUnitsBySource(scan);
    expect(index.get("a")).toEqual(units.filter((item) => item.sourceId === "a"));
    expect(index.get("missing")).toBeUndefined();
    expect(scanUnitsBySource(scan)).toBe(index);
  });

  it("stays linear for large scans", () => {
    const units = Array.from({ length: 200_000 }, (_, index) => unit(`s${index % 20_000}`, index));
    const scan = { units } as unknown as RepositoryKnowledgeScan;
    const started = performance.now();
    const index = scanUnitsBySource(scan);
    for (let source = 0; source < 20_000; source += 1) index.get(`s${source}`);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(index.get("s7")).toHaveLength(10);
  });
});
