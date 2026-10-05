import { describe, expect, it } from "vitest";

import {
  validateRepositoryKnowledgePolicy,
  defaultRepositoryKnowledgePolicy,
} from "../src/policy.js";
import { workstreamFreshnessPolicy } from "../src/policy.js";
import {
  assessWorkstreamFreshness,
  defaultWorkstreamFreshnessPolicy,
  workstreamApprovalConsequence,
} from "../src/workstream-freshness.js";

const updatedAt = "2026-10-01T00:00:00.000Z";
const hour = 3_600_000;

function at(offsetMs: number): Date {
  return new Date(Date.parse(updatedAt) + offsetMs);
}

describe("workstream freshness", () => {
  it("defaults to 20 commits and 48 hours", () => {
    expect(defaultWorkstreamFreshnessPolicy).toEqual({
      staleAfterCommits: 20,
      staleAfterHours: 48,
    });
  });

  it("becomes stale only after the age boundary", () => {
    const boundary = assessWorkstreamFreshness({
      snapshot: { updatedAt },
      headDistance: { status: "measured", commitsBehind: 0 },
      observedAt: at(48 * hour),
    });
    expect(boundary).toMatchObject({ status: "current", reasons: [], ageHours: 48 });
    expect(
      assessWorkstreamFreshness({
        snapshot: { updatedAt },
        headDistance: { status: "measured", commitsBehind: 0 },
        observedAt: at(48 * hour + 1),
      }),
    ).toMatchObject({ status: "stale", reasons: ["age_exceeded"] });
  });

  it("becomes stale only after the commit boundary", () => {
    expect(
      assessWorkstreamFreshness({
        snapshot: { updatedAt },
        headDistance: { status: "measured", commitsBehind: 20 },
        observedAt: at(hour),
      }),
    ).toMatchObject({ status: "current", commitsBehind: 20 });
    expect(
      assessWorkstreamFreshness({
        snapshot: { updatedAt },
        headDistance: { status: "measured", commitsBehind: 21 },
        observedAt: at(hour),
      }),
    ).toMatchObject({ status: "stale", reasons: ["commits_behind"], commitsBehind: 21 });
  });

  it("treats an unresolvable recorded HEAD as stale", () => {
    expect(
      assessWorkstreamFreshness({
        snapshot: { updatedAt },
        headDistance: { status: "unresolvable" },
        observedAt: at(hour),
      }),
    ).toMatchObject({ status: "stale", reasons: ["recorded_head_unresolvable"] });
  });

  it("uses age alone for snapshots that predate HEAD recording", () => {
    expect(
      assessWorkstreamFreshness({
        snapshot: { updatedAt },
        headDistance: { status: "not_recorded" },
        observedAt: at(hour),
      }).status,
    ).toBe("current");
    expect(
      assessWorkstreamFreshness({
        snapshot: { updatedAt },
        headDistance: { status: "not_recorded" },
        observedAt: at(72 * hour),
      }),
    ).toMatchObject({ status: "stale", reasons: ["age_exceeded"] });
  });

  it("does not trust an updatedAt far in the future", () => {
    expect(
      assessWorkstreamFreshness({
        snapshot: { updatedAt },
        headDistance: { status: "not_recorded" },
        observedAt: at(-hour),
      }),
    ).toMatchObject({ status: "stale", reasons: ["updated_at_in_future"] });
  });

  it("applies configured thresholds from the repository knowledge policy", () => {
    const policy = validateRepositoryKnowledgePolicy({
      ...defaultRepositoryKnowledgePolicy,
      workstream: { staleAfterCommits: 2, staleAfterHours: 1 },
    });
    const thresholds = workstreamFreshnessPolicy(policy);
    expect(thresholds).toEqual({ staleAfterCommits: 2, staleAfterHours: 1 });
    expect(
      assessWorkstreamFreshness({
        snapshot: { updatedAt },
        headDistance: { status: "measured", commitsBehind: 3 },
        observedAt: at(2 * hour),
        policy: thresholds,
      }).reasons,
    ).toEqual(["age_exceeded", "commits_behind"]);
    expect(workstreamFreshnessPolicy(defaultRepositoryKnowledgePolicy)).toEqual(
      defaultWorkstreamFreshnessPolicy,
    );
    expect(() =>
      validateRepositoryKnowledgePolicy({
        ...defaultRepositoryKnowledgePolicy,
        workstream: { staleAfterCommits: 0, staleAfterHours: 1 },
      }),
    ).toThrow(/policy contract/u);
  });

  it("classifies every approval kind as a consequential class", () => {
    expect(
      (["repository_bytes", "managed_write", "external_action", "deployment"] as const).map(
        workstreamApprovalConsequence,
      ),
    ).toEqual(["repository_write", "repository_write", "external_effect", "deployment"]);
  });
});
