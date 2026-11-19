import { afterEach, describe, expect, it } from "vitest";

import { extractUnits } from "../src/repository-source-units.js";
import {
  beginMemoizedSourceUnits,
  clearSourceUnitMemo,
  memoizedSourceCount,
} from "../src/source-unit-memo.js";
import { sha256 } from "../src/integrity.js";
import type { ReadableSource } from "../src/source-unit-cache-codec.js";

afterEach(() => clearSourceUnitMemo());

function source(path: string, content: string): ReadableSource {
  return {
    sourceId: `src_${path.replace(/\W/gu, "_")}`,
    path,
    kind: "code",
    status: "included",
    classification: "ordinary",
    byteCount: Buffer.byteLength(content),
    contentHash: sha256(content),
    content,
  } as ReadableSource;
}

const code = "export function alpha() {\n  return 1;\n}\nexport const beta = 2;\n";

describe("source unit memo", () => {
  it("returns exactly what a fresh extraction returns across scans of one project", () => {
    const a = source("src/a.ts", code);
    const fresh = extractUnits("prj_memo", a);
    expect(beginMemoizedSourceUnits("prj_memo", undefined)(a)).toEqual(fresh);
    // The next scan reuses the previous scan's extraction and still equals a fresh one.
    expect(beginMemoizedSourceUnits("prj_memo", undefined)(source("src/a.ts", code))).toEqual(
      fresh,
    );
    const changed = source("src/a.ts", `${code}export const gamma = 3;\n`);
    expect(beginMemoizedSourceUnits("prj_memo", undefined)(changed)).toEqual(
      extractUnits("prj_memo", changed),
    );
  });

  it("keeps each project's working set apart and drops versions no scan uses", () => {
    const scan = (projectId: string, files: ReadableSource[]) => {
      const extract = beginMemoizedSourceUnits(projectId, undefined);
      for (const file of files) extract(file);
    };
    const a = source("src/a.ts", code);
    const b = source("src/b.ts", code);
    scan("prj_one", [a, b]);
    scan("prj_two", [a]);
    expect(memoizedSourceCount("prj_one")).toBe(2);
    expect(memoizedSourceCount("prj_two")).toBe(1);
    // Rewriting b twice leaves at most the latest scans' versions.
    scan("prj_one", [a, source("src/b.ts", `${code}// 1\n`)]);
    scan("prj_one", [a, source("src/b.ts", `${code}// 2\n`)]);
    scan("prj_one", [a, source("src/b.ts", `${code}// 3\n`)]);
    expect(memoizedSourceCount("prj_one")).toBeLessThanOrEqual(4);
  });
});
