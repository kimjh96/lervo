import { describe, expect, it } from "vitest";

import { documentNormalizationWorksetBinding, sha256 } from "../src/index.js";

describe("document normalization workset binding", () => {
  it("uses the same path order for explicit selection and source bindings", () => {
    const documents = ["docs/alpha.md", "docs/Zeta.md"].map((path) => ({
      path,
      contentHash: sha256(path),
      byteCount: 1,
    }));
    const input = {
      scope: "all_pending" as const,
      sourceSnapshotId: "ksnap_test",
      eligibleDocuments: 2,
      currentDocuments: 0,
      pendingDocuments: 2,
      staleDocuments: 0,
      selectionPaths: ["docs/Zeta.md", "docs/alpha.md"],
      documents,
    };

    expect(documentNormalizationWorksetBinding(input)).toEqual(
      documentNormalizationWorksetBinding({
        ...input,
        selectionPaths: [...input.selectionPaths].reverse(),
        documents: [...documents].reverse(),
      }),
    );
  });
});
