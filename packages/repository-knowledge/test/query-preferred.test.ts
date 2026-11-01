import { expect, it } from "vitest";

import { preferHits } from "../src/query.js";
import type { KnowledgeQueryHit } from "../src/types.js";

const hit = (path: string, score = 10) =>
  ({ path, score, matchedTerms: [] }) as unknown as KnowledgeQueryHit;
const entry = (path: string, historical = false) =>
  ({ hit: { path }, historical }) as unknown as Parameters<typeof preferHits>[2][number];
const toHit = (value: { hit: { path: string } }, score: number) => hit(value.hit.path, score);

it("puts up to five preferred documents first: weight, then ranked order, then path", () => {
  const ranked = ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md"].map((path) => hit(path));
  const entries = [...ranked.map((item) => entry(item.path)), entry("x.md"), entry("old.md", true)];
  const result = preferHits(
    ranked,
    [
      { path: "f.md", weight: 1 },
      { path: "c.md", weight: 1 },
      { path: "x.md", weight: 3 },
      { path: "old.md", weight: 9 },
      { path: "missing.md", weight: 9 },
      { path: "g.md", weight: 1 },
      { path: "e.md", weight: 1 },
      { path: "d.md", weight: 1 },
    ],
    entries,
    (value) => !value.historical,
    toHit,
    6,
  ).map((item) => item.path);
  // x.md names three targets; ties keep ranked order; only five are preferred.
  expect(result).toEqual(["x.md", "c.md", "d.md", "e.md", "f.md", "a.md"]);
});

it("keeps the ranked list unchanged without preferred documents", () => {
  const ranked = [hit("a.md"), hit("b.md")];
  expect(preferHits(ranked, [], [], () => true, toHit, 10)).toEqual(ranked);
});
