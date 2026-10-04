import type { WorkforceAssignment } from "@lervo/agent-workforce";
import { expect, it } from "vitest";

import { hasCurrentForegroundLease } from "../src/foreground-admission.js";

const now = Date.parse("2026-09-28T00:00:00.000Z");
const assignment = (expiresAt: string) =>
  ({
    status: "leased",
    lease: { expiresAt },
    convergence: null,
    knowledgeJob: null,
  }) as WorkforceAssignment;

it("defers read-only provider admission to a current foreground lease", () => {
  expect(hasCurrentForegroundLease([assignment("2026-09-28T00:00:01.000Z")], now)).toBe(true);
});

it("does not let expired metadata indefinitely defer admission or mutate uncertain work", () => {
  const expired = assignment("2026-09-14T09:34:06.068Z");
  const before = structuredClone(expired);
  expect(hasCurrentForegroundLease([expired], now)).toBe(false);
  expect(expired).toEqual(before);
  expect(expired.status).toBe("leased");
  expect(hasCurrentForegroundLease([assignment("2026-09-28T00:00:00.000Z")], now)).toBe(false);
});

it("keeps missing or malformed foreground expiry fail-closed", () => {
  expect(hasCurrentForegroundLease([assignment("invalid")], now)).toBe(true);
  expect(hasCurrentForegroundLease([{ ...assignment("invalid"), lease: null }], now)).toBe(true);
});

it("does not count background assignments or unclaimed work as a live foreground lease", () => {
  const current = assignment("2026-09-28T00:00:01.000Z");
  expect(
    hasCurrentForegroundLease(
      [
        { ...current, convergence: {} } as WorkforceAssignment,
        { ...current, knowledgeJob: {} } as WorkforceAssignment,
        { ...current, status: "queued", lease: null },
      ],
      now,
    ),
  ).toBe(false);
});
