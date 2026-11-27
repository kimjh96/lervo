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

/** Convergence stages the workforce lists beside the real assignments. */
const stages = vi.hoisted(() => ({ extra: [] as WorkforceAssignment[] }));
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
    stages.extra = [waitingStage(["src/a.ts"], new Date(now.getTime() - DAY - 3_600_000))];

    const items = await readConvergenceStageHoldDebt(repository, now);
    expect(items).toEqual([
      expect.objectContaining({
        kind: "knowledge_convergence_continuity",
        state: "lervo_debt",
        findingCode: "convergence_stage_held",
        severity: "lervo_debt",
        detail: first.workspaceId,
        observedAt: stages.extra[0]!.createdAt,
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

  it("is no debt within a day, when nothing overlaps, or while the gate is closed", async () => {
    const { first, repository } = app;
    await claim(first, "src/a.ts");
    const now = new Date();
    stages.extra = [waitingStage(["src/a.ts"], new Date(now.getTime() - DAY + 60_000))];
    expect(await readConvergenceStageHoldDebt(repository, now)).toEqual([]);

    stages.extra = [waitingStage(["docs/guide.md"], new Date(now.getTime() - 2 * DAY))];
    expect(await readConvergenceStageHoldDebt(repository, now)).toEqual([]);

    stages.extra = [waitingStage(["src/a.ts"], new Date(now.getTime() - 2 * DAY))];
    expect(await readConvergenceStageHoldDebt(repository, now)).toHaveLength(1);
    expect(
      await readConvergenceStageHoldDebt(repository, now, { LERVO_COORDINATION: "0" }),
    ).toEqual([]);
  }, 60_000);
});
