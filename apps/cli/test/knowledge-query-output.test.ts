import { describe, expect, it } from "vitest";

import {
  knowledgeQueryHeadline,
  knowledgeQueryHitLine,
  readKnowledgeQueryOutput,
} from "../src/knowledge-query-output.js";

describe("the knowledge query's text output", () => {
  it("reads back the count and hits it prints, in rank order", () => {
    const hits = [
      {
        score: 64105,
        title: "Lervo ADE delivery",
        path: "docs/roadmap/ade.md",
        freshness: "current" as const,
      },
      {
        score: 7,
        title: "Login · limits",
        path: "docs/specs/login limits.md",
        freshness: "stale" as const,
      },
    ];
    const output = [
      knowledgeQueryHeadline(12),
      "Scan coverage: complete; skipped for budget: 0 sources, 0 bytes.",
      ...hits.map(knowledgeQueryHitLine),
      "Applied owner instructions: complete; 3 complete clauses prepared; 0 omitted; provider delivery unobserved.",
    ].join("\n");
    expect(readKnowledgeQueryOutput(output)).toEqual({
      found: 12,
      hits: hits.map(({ title, path, freshness }) => ({ title, path, freshness })),
    });
  });

  it("reads nothing from output that does not start with the headline", () => {
    expect(readKnowledgeQueryOutput("Usage: lervo knowledge query <text>")).toBeUndefined();
    expect(readKnowledgeQueryOutput(`${knowledgeQueryHeadline(0)}\n`)).toEqual({
      found: 0,
      hits: [],
    });
  });
});
