import { expect, it } from "vitest";
import { identifySearchQuery } from "@lervo/search";
import { projectTaskQuery } from "../src/task-query-projection.js";
it("budgets actual search terms including paths, punctuation, and expansion", () => {
  const intent =
    "Complete the current Lervo workforce assignment through the managed execution contract. Assignment ID: asn_12345 Task type: implementation Acceptance criteria: Create the installed scheduled result. Work only within the assignment's exact authorized paths and satisfy its verification suites.";
  const result = projectTaskQuery({ intent, targetPaths: ["src/result.ts"] });
  expect(() => identifySearchQuery(result.query)).not.toThrow();
  expect(result.query).toContain("src/result.ts");
  const expanded = projectTaskQuery({
    intent: "성능 검색 캐시 배포 권한 복구 오류 동시 문서 ".repeat(10),
    targetPaths: ["packages/context/src/quality-plan.ts"],
  });
  expect(() => identifySearchQuery(expanded.query)).not.toThrow();
  expect(expanded.query).toContain("packages/context/src/quality-plan.ts");
});
it("preserves admitted identifiers exactly and never emits a partial long path", () => {
  const path = `src/${"identifier".repeat(50)}.ts`;
  const result = projectTaskQuery({ intent: "Repair ADR-0501", targetPaths: [path] });
  expect(result.query).toContain("ADR-0501");
  expect(result.query).not.toContain("src/");
  expect(() =>
    identifySearchQuery(projectTaskQuery({ intent: "ＡＢＣ １２３" }).query),
  ).not.toThrow();
});
