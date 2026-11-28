import { describe, expect, it } from "vitest";

import { gitIndexLockAttentionItems } from "../src/git-index-lock-attention.js";
import { createOperatingAttentionReport } from "../src/operating-attention-projection.js";
import {
  knowledgeEffectHoldBlockers,
  knowledgeEffectHoldReason,
} from "../src/upgrade-knowledge-gate.js";

const lock = {
  path: ".git/index.lock",
  ageSeconds: 42 * 24 * 3600,
  modifiedAt: "2026-10-29T08:00:00.000Z",
};

describe("a stale Git index lock", () => {
  it("names its path and age as an upgrade stage blocker instead of a busy Git", () => {
    const hold = { reason: "commit_unavailable" as const, detail: "git_index_lock_stale", lock };
    expect(knowledgeEffectHoldReason(hold)).toBe("git_index_lock_stale");
    const [blocker] = knowledgeEffectHoldBlockers(hold);
    expect(blocker).toMatchObject({ code: "git_index_lock_stale", path: ".git/index.lock" });
    expect(blocker?.message).toContain("60480 minutes old (since 2026-10-29T08:00:00.000Z)");
    expect(blocker?.message).toContain("rm .git/index.lock");
    // A busy Git without a stale lock adds no blocker; its reason alone stays.
    expect(
      knowledgeEffectHoldBlockers({
        reason: "commit_unavailable",
        detail: "git_unavailable_or_busy",
      }),
    ).toEqual([]);
  });

  it("is one owner item in the operating attention report, never Lervo debt", () => {
    expect(gitIndexLockAttentionItems(null)).toEqual([]);
    const report = createOperatingAttentionReport({
      projectId: "prj_0123456789abcdef",
      workstream: null,
      workstreamFreshness: null,
      canonicalization: { coverage: "complete", candidates: [] },
      knowledgeLifecycle: { coverage: "complete", issues: [] },
      staleGitIndexLock: lock,
      observedAt: new Date("2026-11-28T12:00:00.000Z"),
    });
    expect(report.status).toBe("action_required");
    expect(report.summary.userActionCount).toBe(1);
    expect(report.items).toEqual([
      expect.objectContaining({
        kind: "git_index_lock_stale",
        state: "action_required",
        path: ".git/index.lock",
        actionOwner: "user",
        requiresUserAction: true,
        instruction: expect.stringContaining("Lervo never deletes it"),
        attribution: expect.objectContaining({
          actor: "owner",
          consequence: "owner_repository_file",
        }),
      }),
    ]);
  });
});
