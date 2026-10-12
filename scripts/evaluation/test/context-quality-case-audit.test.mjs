import { expect, it } from "vitest";
import { auditCasePopulation } from "../lib/context-quality-case-audit.mjs";
it("preserves prior review without promoting tuning cases or leaking query text", async () => {
  const { suite, report } = await auditCasePopulation(process.cwd());
  expect(report.realFamilies).toHaveLength(4);
  expect(report.readiness).toMatchObject({
    existingRealFamilies: 4,
    additionalRealFamiliesNeeded: 96,
    eligibleUnseenHeldOutFamilies: 0,
    fullyReviewedAdr0501Families: 0,
  });
  expect(report.retainedRegressions).toHaveLength(4);
  expect(
    report.realFamilies.every((item) => item.priorTuningExposure && !item.newHeldOutEligible),
  ).toBe(true);
  for (const item of suite.cases) expect(JSON.stringify(report)).not.toContain(item.query);
});
