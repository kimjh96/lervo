import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkforceAssignment } from "@lervo/agent-workforce";

import { readConvergenceStageHoldDebt } from "../src/convergence-stage-hold-debt.js";
import {
  knowledgeConvergenceAttentionItems,
  readKnowledgeConvergenceAttention,
} from "../src/knowledge-convergence-attention.js";
import { attentionLervoDebt } from "../src/repository-health-lervo-debt.js";
import { parseTerminalHookIngress } from "../src/terminal-hook-input.js";
import { answerClaimHook } from "../src/write-claims.js";
import { claimFixture, type ClaimFixture } from "./conversation-claim-fixture.js";

/**
 * Convergence stages the workforce lists beside the real assignments, and the obligations the
 * canonical convergence events replay to.
 */
const stages = vi.hoisted(() => ({ extra: [] as WorkforceAssignment[], rows: [] as unknown[] }));
vi.mock("@lervo/repository-knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lervo/repository-knowledge")>()),
  replayKnowledgeConvergence: () => stages.rows,
}));
vi.mock("@lervo/agent-workforce", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lervo/agent-workforce")>();
  return {
    ...actual,
    listAssignments: async (...input: Parameters<typeof actual.listAssignments>) => [
      ...(await actual.listAssignments(...input)),
      ...stages.extra,
    ],
  };
});

let app: ClaimFixture;

beforeEach(async () => {
  stages.extra = [];
  stages.rows = [];
  app = await claimFixture();
}, 60_000);

afterEach(async () => {
  await app.cleanup();
});

const DAY = 24 * 60 * 60_000;

/** A knowledge convergence writer whose claim of `paths` has waited since `createdAt`. */
function waitingStage(paths: string[], createdAt: Date): WorkforceAssignment {
  return {
    assignmentId: `asn_${"7".repeat(24)}`,
    taskType: "knowledge.convergence.normalization_apply.0123456789abcdef01234567",
    status: "queued",
    accessMode: "write",
    expectedPaths: paths,
    lease: null,
    dependencyIds: [],
    convergence: { obligationId: "kob_held", stage: "normalization_apply" },
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  } as unknown as WorkforceAssignment;
}

/** An obligation whose latest stage record is `state` for `failureCode`, settled at `at`. */
function obligation(
  at: Date,
  options: { state?: string; failureCode?: string | null; outcome?: boolean } = {},
) {
  return {
    baseline: { payload: { obligationId: "kob_held" } },
    latest: {
      payload: {
        obligationId: "kob_held",
        stage: "normalization_apply",
        state: options.state ?? "waiting_authority",
        failureCode:
          options.failureCode === undefined ? "assignment_path_conflict" : options.failureCode,
        occurredAt: at.toISOString(),
      },
    },
    outcome: options.outcome === true ? { payload: { terminalState: "superseded" } } : null,
  };
}

/** The lead of `conversation` claims `path` in its worktree. */
async function claim(conversation: ClaimFixture["first"], path: string): Promise<void> {
  const parsed = parseTerminalHookIngress(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: conversation.sessionId,
      tool_name: "Write",
      tool_input: { file_path: resolve(conversation.worktree, path), content: "x" },
      tool_use_id: "toolu_1",
      cwd: conversation.worktree,
    }),
  );
  if (parsed.event !== "PreToolUse") throw new Error("not a pre-tool input");
  expect(await answerClaimHook(parsed, "claude", conversation.worktree)).toBe("{}\n");
}

describe("a convergence stage a conversation holds", () => {
  it("is Lervo debt with its age and the holder's conversation after a day", async () => {
    const { first, repository } = app;
    await claim(first, "src/a.ts");
    const now = new Date();
    // The writer was created days ago; its current hold settled 25 hours ago.
    stages.extra = [waitingStage(["src/a.ts"], new Date(now.getTime() - 3 * DAY))];
    const settled = new Date(now.getTime() - DAY - 3_600_000);
    stages.rows = [obligation(settled)];

    const items = await readConvergenceStageHoldDebt(repository, now);
    expect(items).toEqual([
      expect.objectContaining({
        kind: "knowledge_convergence_continuity",
        state: "lervo_debt",
        findingCode: "convergence_stage_held",
        severity: "lervo_debt",
        detail: first.workspaceId,
        observedAt: settled.toISOString(),
        actionOwner: "host resident",
        requiresUserAction: false,
        blocking: false,
      }),
    ]);
    expect(items[0]!.instruction).toContain("normalization_apply has waited 25 hours");
    expect(attentionLervoDebt(items[0]!)).toMatchObject({ reason: "convergence_stage_held" });

    // The attention report carries it with the convergence items.
    const attention = await readKnowledgeConvergenceAttention(repository, "prj_test");
    expect(
      knowledgeConvergenceAttentionItems(attention).filter(
        (item) => "findingCode" in item && item.findingCode === "convergence_stage_held",
      ),
    ).toHaveLength(1);
  }, 60_000);

  it("is no debt within a day of its hold, after its obligation ended, when nothing overlaps, or while the gate is closed", async () => {
    const { first, repository } = app;
    await claim(first, "src/a.ts");
    const now = new Date();
    const old = new Date(now.getTime() - 2 * DAY);
    stages.extra = [waitingStage(["src/a.ts"], new Date(now.getTime() - 3 * DAY))];
    // The age counts from the hold's settlement, not the writer's creation.
    stages.rows = [obligation(new Date(now.getTime() - DAY + 60_000))];
    expect(await readConvergenceStageHoldDebt(repository, now)).toEqual([]);
    // A superseded or archived obligation, or one no longer waiting on a claim, holds nothing.
    for (const row of [
      obligation(old, { outcome: true }),
      obligation(old, { state: "queued", failureCode: null }),
      obligation(old, { failureCode: "knowledge_provider_paused" }),
    ]) {
      stages.rows = [row];
      expect(await readConvergenceStageHoldDebt(repository, now)).toEqual([]);
    }

    stages.rows = [obligation(old)];
    stages.extra = [waitingStage(["docs/guide.md"], new Date(now.getTime() - 3 * DAY))];
    expect(await readConvergenceStageHoldDebt(repository, now)).toEqual([]);

    stages.extra = [waitingStage(["src/a.ts"], new Date(now.getTime() - 3 * DAY))];
    expect(await readConvergenceStageHoldDebt(repository, now)).toHaveLength(1);
    expect(
      await readConvergenceStageHoldDebt(repository, now, { LERVO_COORDINATION: "0" }),
    ).toEqual([]);
  }, 60_000);
});
