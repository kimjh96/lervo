import { describe, expect, it } from "vitest";

import {
  knowledgeQueryCoverageNotes,
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

  it("names each evidence source it left out and stays silent when all were verified", () => {
    expect(
      knowledgeQueryCoverageNotes("built", {
        verificationResults: { status: "complete" },
        executionEvents: { status: "complete" },
      }),
    ).toEqual([]);
    const notes = knowledgeQueryCoverageNotes("built", {
      verificationResults: { status: "partial", omittedCount: 2 },
      executionEvents: { status: "omitted" },
    });
    expect(notes).toEqual([
      "Evidence degraded: 2 recorded verification results could not be verified against their suite or stored original and were left out of the search; repository files and owner rules are unaffected.",
      "Evidence degraded: the recorded execution events could not be verified, so they were left out of the search; repository files and owner rules are unaffected.",
    ]);
    // The notes never read as hits, so the ADE's reading of the output is unchanged.
    expect(readKnowledgeQueryOutput([knowledgeQueryHeadline(0), ...notes].join("\n"))).toEqual({
      found: 0,
      hits: [],
    });
  });
});
