import { defaultRepositoryDocumentPolicy } from "@lervo/project";
import { describe, expect, it } from "vitest";

import {
  evaluateDocumentRewriters,
  projectManagedIgnoreConfiguration,
  type DocumentRewriterDescriptor,
} from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;

const prettier: DocumentRewriterDescriptor = {
  rewriterId: "prettier",
  version: "3",
  capability: "format",
  scopePaths: ["."],
  configurationHash: hash,
  lockHash: hash,
  compatibility: {
    kind: "managed_ignore",
    configurationPath: ".prettierignore",
    maximumManagedRuleCount: 256,
  },
};

const markdownTransform: DocumentRewriterDescriptor = {
  rewriterId: "markdown-transform",
  version: "1",
  capability: "transform",
  scopePaths: ["docs"],
  configurationHash: hash,
  lockHash: hash,
  compatibility: { kind: "content_bound_dry_run", maximumObservations: 64 },
};

describe("document rewriter ownership", () => {
  it("preserves user ignore bytes and compacts only a uniformly owned subtree", () => {
    const projection = projectManagedIgnoreConfiguration({
      currentContent: "node_modules/\n",
      ownedPaths: ["docs/decisions/a.md", "docs/decisions/b.md", "docs/decisions/c.md"],
      allDocumentPaths: [
        "README.md",
        "docs/decisions/a.md",
        "docs/decisions/b.md",
        "docs/decisions/c.md",
      ],
      maximumRules: 8,
      maximumBytes: 1024,
    });
    expect(projection.rules).toEqual(["docs/"]);
    expect(projection.content).toContain("node_modules/\n# lervo:begin");
    expect(projection.approvalRequired).toBe(true);
    const refreshed = projectManagedIgnoreConfiguration({
      currentContent: projection.content,
      ownedPaths: ["docs/decisions/a.md"],
      allDocumentPaths: ["README.md", "docs/decisions/a.md"],
      maximumRules: 8,
      maximumBytes: 1024,
    });
    expect(refreshed.content.startsWith("node_modules/\n")).toBe(true);
    expect(refreshed.approvalRequired).toBe(false);
  });

  it("blocks unsafe negation and finite rule overflow", () => {
    expect(() =>
      projectManagedIgnoreConfiguration({
        currentContent: "!docs/private.md\n",
        ownedPaths: ["docs/a.md"],
        allDocumentPaths: ["docs/a.md"],
        maximumRules: 8,
        maximumBytes: 1024,
      }),
    ).toThrow("Negated ignore rules");
    expect(() =>
      projectManagedIgnoreConfiguration({
        currentContent: null,
        ownedPaths: ["a.md", "b.md"],
        allDocumentPaths: ["a.md", "b.md"],
        maximumRules: 1,
        maximumBytes: 1024,
      }),
    ).toThrow("finite limit");
  });

  it("proves two structurally different adapters through one core contract", () => {
    const result = evaluateDocumentRewriters({
      ownership: [
        {
          path: "docs/reviewed.md",
          owner: "reviewer",
          rewritePolicy: "reviewed_exact",
        },
      ],
      rewriters: [prettier, markdownTransform],
      managedRules: { prettier: ["docs/reviewed.md"] },
      dryRuns: {
        "markdown-transform": [{ path: "docs/reviewed.md", beforeHash: hash, afterHash: hash }],
      },
      contract: defaultRepositoryDocumentPolicy.rewrite,
      policyHash: hash,
    });
    expect(result).toEqual({ status: "compatible", blockers: [] });

    const unmanaged = evaluateDocumentRewriters({
      ownership: [],
      rewriters: [{ ...markdownTransform, compatibility: { kind: "unmanaged" } }],
      managedRules: {},
      dryRuns: {},
      contract: defaultRepositoryDocumentPolicy.rewrite,
      policyHash: hash,
    });
    expect(unmanaged.blockers).toEqual([
      expect.objectContaining({ code: "document_rewriter_unmanaged" }),
    ]);
  });
});
