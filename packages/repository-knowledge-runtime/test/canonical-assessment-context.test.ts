import { expect, it } from "vitest";
import { selectCanonicalAssessmentContext } from "../src/canonical-assessment-context.js";

it("retains every bounded review document for assessment and independent review", () => {
  const context = [
    { path: "AGENTS.md", role: "instruction" as const },
    ...Array.from({ length: 8 }, (_, index) => ({
      path: `docs/reference-${index}.md`,
      role: "canonical_candidate" as const,
    })),
    { path: "nested/AGENTS.md", role: "instruction" as const },
  ].map((item) => ({ ...item, contentHash: `hash:${item.path}`, content: item.path }));
  expect(selectCanonicalAssessmentContext(context).map((item) => item.path)).toEqual([
    "AGENTS.md",
    "nested/AGENTS.md",
    "docs/reference-0.md",
    "docs/reference-1.md",
    "docs/reference-2.md",
    "docs/reference-3.md",
    "docs/reference-4.md",
    "docs/reference-5.md",
    "docs/reference-6.md",
    "docs/reference-7.md",
  ]);
});
