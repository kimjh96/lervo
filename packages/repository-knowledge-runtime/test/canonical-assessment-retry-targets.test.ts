import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { loadAssessmentRetryTargets } from "../src/canonical-assessment-retry-targets.js";

it("loads only permitted captured draft targets within the retry content bound", () => {
  const root = mkdtempSync(join(tmpdir(), "lervo-retry-targets-"));
  try {
    mkdirSync(join(root, "docs"));
    mkdirSync(join(root, "src"));
    const allowed = "# Existing gates\n";
    const large = "x".repeat(64 * 1024);
    writeFileSync(join(root, "docs", "existing.md"), allowed);
    writeFileSync(join(root, "docs", "large.md"), large);
    writeFileSync(join(root, "src", "private.ts"), "private source\n");
    const sources = [
      { path: "docs/existing.md", contentHash: sha256(allowed), kind: "text" as const },
      { path: "docs/large.md", contentHash: sha256(large), kind: "text" as const },
      { path: "src/private.ts", contentHash: sha256("private source\n"), kind: "text" as const },
    ];
    const result = loadAssessmentRetryTargets({
      repositoryRoot: root,
      response: {
        drafts: [
          { path: "src/private.ts" },
          { path: "docs/existing.md" },
          { path: "docs/large.md" },
          { path: "docs/new.md" },
        ],
      },
      capturedSources: sources,
      canonicalRoots: ["docs"],
    });
    expect(result).toEqual([
      { path: "docs/existing.md", contentHash: sha256(allowed), content: allowed },
      { path: "docs/large.md", contentHash: sha256(large), content: null },
    ]);
    writeFileSync(join(root, "docs", "existing.md"), "# Changed gates\n");
    expect(() =>
      loadAssessmentRetryTargets({
        repositoryRoot: root,
        response: { drafts: [{ path: "docs/existing.md" }] },
        capturedSources: sources,
        canonicalRoots: ["docs"],
      }),
    ).toThrowError(expect.objectContaining({ code: "source_bytes_changed" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
