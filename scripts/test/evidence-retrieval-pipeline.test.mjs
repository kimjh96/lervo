import { describe, expect, it } from "vitest";

import {
  prioritizeCanonicalEvidence,
  selectEvidenceRecommendations,
} from "../natural-language-evaluation/evidence-retrieval-pipeline.mjs";

function source(path, text) {
  return { path, text, contentHash: `sha256:${"a".repeat(64)}` };
}

describe("evidence retrieval pipeline", () => {
  it("adds bounded explicit links and the strongest focused section", () => {
    const anchors = [
      source("docs/a.md", "# A\nSee [related](related.md)."),
      source("docs/b.md", "# B\nGeneral material."),
      source("docs/c.md", "# C\nGeneral material."),
    ];
    const related = source("docs/related.md", "# Related\nExact merge approval rationale.");
    const weak = source("docs/weak.md", "# Weak\nApproval only.");
    const focused = source(
      "docs/specifications/focused.md",
      "# Focused\n## Contract\nUser content and managed blocks require explicit approval.",
    );
    const ranked = [...anchors, weak, focused, related];
    const byPath = new Map(ranked.map((item) => [item.path, item]));

    expect(
      selectEvidenceRecommendations(ranked, "user content managed blocks approval", byPath).map(
        (item) => item.path,
      ),
    ).toEqual([
      "docs/specifications/focused.md",
      "docs/a.md",
      "docs/b.md",
      "docs/c.md",
      "docs/related.md",
    ]);
  });

  it("ignores provider identity and expected paths in pipeline options", () => {
    const ranked = [
      source("docs/a.md", "# A\nalpha"),
      source("docs/b.md", "# B\nbeta"),
      source("docs/c.md", "# C\ngamma"),
    ];
    const byPath = new Map(ranked.map((item) => [item.path, item]));

    expect(
      selectEvidenceRecommendations(ranked, "alpha", byPath, {
        provider: "ignored",
        expectedPaths: ["docs/secret.md"],
      }),
    ).toEqual(selectEvidenceRecommendations(ranked, "alpha", byPath));
  });

  it("prioritizes canonical current sources and query alignment inside a source role", () => {
    const decision = source("docs/decisions/example.md", "# Decision");
    const distribution = source(
      "docs/distribution/release.md",
      "# Distribution\nGeneral material.",
    );
    const specification = source(
      "docs/specifications/execution.md",
      "# Execution\nRelease preparation order and version management.",
    );

    expect(
      prioritizeCanonicalEvidence(
        [decision, distribution, specification],
        "다음 release 준비 순서 알려줘",
      ).map((item) => item.path),
    ).toEqual([specification.path, distribution.path, decision.path]);
  });

  it("ranks a directly answering distribution source ahead of a related roadmap", () => {
    const roadmap = source(
      "docs/roadmap/release/version-management-automation.md",
      "# Version automation\nRelease automation roadmap and future status.",
    );
    const distribution = source(
      "docs/distribution/cli-version-management.md",
      "# CLI version management\nExact release preparation order and version procedure.",
    );

    expect(
      prioritizeCanonicalEvidence(
        [roadmap, distribution],
        "CLI version management 다음 release 준비 순서 뭐지?",
      ).map((item) => item.path),
    ).toEqual([distribution.path, roadmap.path]);
  });

  it("prioritizes decisions for historical rationale without using task labels", () => {
    const roadmap = source("docs/roadmap/v0.md", "# Roadmap");
    const olderDecision = source("docs/decisions/older.md", "# Older");
    const newerDecision = source("docs/decisions/newer.md", "# Newer");

    expect(
      prioritizeCanonicalEvidence(
        [roadmap, olderDecision, newerDecision],
        "예전에 이 결정을 왜 했지?",
      ).map((item) => item.path),
    ).toEqual([olderDecision.path, newerDecision.path, roadmap.path]);
  });

  it("does not spend the focused-expansion budget on weak two-term overlap", () => {
    const anchors = [
      source("docs/a.md", "# A\nGeneral"),
      source("docs/b.md", "# B\nGeneral"),
      source("docs/c.md", "# C\nGeneral"),
    ];
    const weak = source(
      "docs/specifications/weak.md",
      "# Weak\nThis mentions approval and merge only.",
    );
    const ranked = [...anchors, weak];

    expect(
      selectEvidenceRecommendations(
        ranked,
        "approval merge conflict boundary",
        new Map(ranked.map((item) => [item.path, item])),
      ).map((item) => item.path),
    ).toEqual(anchors.map((item) => item.path));
  });

  it("can place an explicit linked authority before secondary anchors", () => {
    const primary = source("docs/decisions/primary.md", "# Primary\nGeneral conflict rule.");
    const secondary = source(
      "docs/decisions/secondary.md",
      "# Secondary\nSee [exact authority](exact.md).",
    );
    const exact = source("docs/decisions/exact.md", "# Exact\nExact authority.");
    const ranked = [primary, secondary, exact];

    expect(
      selectEvidenceRecommendations(
        ranked,
        "왜 conflict rule을 선택했지?",
        new Map(ranked.map((item) => [item.path, item])),
        {
          anchorLimit: 2,
          linkedExpansionLimit: 1,
          linkedExpansionBeforeSecondaryAnchors: true,
        },
      ).map((item) => item.path),
    ).toEqual([primary.path, exact.path, secondary.path]);
  });
});
