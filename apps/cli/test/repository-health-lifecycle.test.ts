import type { RepositoryHealthDocumentLifecycleV1 } from "@lervo/application-contract";
import { describe, expect, it } from "vitest";

import { formatRepositoryHealth } from "../src/repository-health-format.js";
import { validHealthProjection } from "../src/repository-health-validation.js";
import { healthNow, healthyProjection } from "./repository-health-fixture.js";

const lifecycle: RepositoryHealthDocumentLifecycleV1 = {
  current: 12,
  refreshed: 1,
  partiallySuperseded: 0,
  superseded: 4,
  archived: 2,
  retired: 0,
  suspect: { provider: 2, mechanical: 1, cadence: 5, unknown: 0 },
  cadence: { perDay: 16, periodDays: 14, unassessed: 5, remainingDays: 1 },
};

describe("document lifecycle counts in repository health (ADR-0562)", () => {
  it("accepts projections with or without lifecycle counts and rejects malformed ones", () => {
    const projection = healthyProjection();
    expect(validHealthProjection(projection)).toBe(true);
    const value = projection.measures.freshness.value!;
    projection.measures.freshness.value = { ...value, lifecycle: null };
    expect(validHealthProjection(projection)).toBe(true);
    projection.measures.freshness.value = { ...value, lifecycle };
    expect(validHealthProjection(projection)).toBe(true);
    projection.measures.freshness.value = {
      ...value,
      lifecycle: { ...lifecycle, suspect: { ...lifecycle.suspect, provider: -1 } },
    };
    expect(validHealthProjection(projection)).toBe(false);
    projection.measures.freshness.value = {
      ...value,
      lifecycle: { ...lifecycle, cadence: { ...lifecycle.cadence, perDay: 1.5 } },
    };
    expect(validHealthProjection(projection)).toBe(false);
  });

  it("keeps the freshness line on the staleness findings while the lifecycle runs in shadow", () => {
    const projection = healthyProjection();
    const freshness = projection.measures.freshness;
    freshness.status = "gap";
    freshness.value = { ...freshness.value!, stale: 2, evaluated: 10, unevaluated: 0, lifecycle };
    expect(formatRepositoryHealth(projection, healthNow)).toContain(
      "Lervo health: 2/10 evaluated documents stale, 0 unevaluated; freshness cycle.",
    );
  });
});
