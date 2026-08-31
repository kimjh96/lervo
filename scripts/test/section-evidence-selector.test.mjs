import { describe, expect, it } from "vitest";

import {
  lexicalTermCoverage,
  selectSectionEvidence,
} from "../natural-language-evaluation/section-evidence-selector.mjs";

const source = {
  contentHash: `sha256:${"a".repeat(64)}`,
  text: [
    "# Execution contract",
    "General execution background.",
    "## Evidence states",
    "Selected, loaded, injected, and used are distinct evidence states.",
    "## Managed writes",
    "Managed writes require review and approval.",
    "## Unrelated appendix",
    "Historical details that do not answer the question.",
  ].join("\n\n"),
};

describe("section evidence selector", () => {
  it("selects complete relevant Markdown sections deterministically", () => {
    const first = selectSectionEvidence(source, "selected loaded injected used evidence");
    const second = selectSectionEvidence(source, "selected loaded injected used evidence");

    expect(first).toEqual(second);
    expect(first.content).toContain("## Evidence states");
    expect(first.content).toContain("distinct evidence states");
    expect(first.content).not.toContain("Unrelated appendix");
    expect(first.scope).toEqual({ kind: "sections", sections: ["section-2"] });
    expect(first.sourceContentHash).toBe(source.contentHash);
  });

  it("never uses expected paths or provider identity as selector input", () => {
    expect(Object.keys(selectSectionEvidence(source, "managed writes approval")).sort()).toEqual([
      "byteCount",
      "content",
      "contentHash",
      "scope",
      "selectionScore",
      "sourceContentHash",
    ]);
  });

  it("keeps an oversized winning section whole instead of truncating it", () => {
    const content = `## Canonical\nneedle ${"complete paragraph ".repeat(600)}`;
    const selected = selectSectionEvidence(
      { contentHash: source.contentHash, text: `${content}\n\n## Other\nnoise` },
      "needle",
    );

    expect(selected.content).toBe(content.trim());
    expect(selected.byteCount).toBeGreaterThan(6_000);
  });

  it("measures distinct query-term coverage across complete documents", () => {
    expect(
      lexicalTermCoverage(
        "resolved in one section; loaded and used elsewhere",
        "resolved loaded used missing",
      ),
    ).toBe(3);
  });

  it("separates Korean particles appended to Latin identifiers", () => {
    expect(
      lexicalTermCoverage(
        "A skill can be resolved without being loaded or used.",
        "skill이 resolved여도 loaded나 used로 기록하면 안 돼",
      ),
    ).toBe(4);
  });
});
