import { assessWorkstreamFreshness, formatWorkstreamContext } from "@lervo/repository-knowledge";
import type { WorkstreamSnapshot } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { formatTerminalAttentionContext } from "../src/operating-attention-format.js";
import { createOperatingAttentionReport } from "../src/operating-attention-projection.js";
import {
  assembleCompactTerminalContext,
  formatCompactTerminalPreamble,
  formatCompactWorkstreamContext,
} from "../src/terminal-compact-format.js";
import {
  MAXIMUM_COMPACT_CONTEXT_BYTES,
  MAXIMUM_TERMINAL_ATTENTION_BYTES,
} from "../src/terminal-context-budget.js";

const RISKY_SUMMARY = "Approve the risk-increasing trading campaign deployment.";
const RISKY_QUESTION = "Should the retired campaign be re-enabled for live spend?";

const workstream: WorkstreamSnapshot = {
  schemaVersion: 1,
  workstreamId: "wks_0123456789abcdef01234567",
  revision: 187,
  status: "blocked",
  title: "Stale attention fixture",
  objective: "Keep old authority requests out of current prompts.",
  nextActions: ["Re-enable the campaign."],
  blockers: ["Waiting for the campaign approval."],
  notes: [],
  references: [],
  pendingDecisions: [
    {
      decisionId: "wdec_0123456789abcdef",
      question: RISKY_QUESTION,
      choices: [
        { choiceId: "enable", label: "Enable", consequence: "Spends budget." },
        { choiceId: "retire", label: "Retire", consequence: "Keeps it off." },
      ],
      recommendedChoiceId: "enable",
      blocking: true,
    },
  ],
  pendingApprovals: [
    {
      approvalId: "wapr_0123456789abcdef",
      kind: "deployment",
      summary: RISKY_SUMMARY,
      bindingHash: `sha256:${"a".repeat(64)}`,
      blocking: true,
    },
  ],
  origin: {
    kind: "created",
    sourceArtifactId: null,
    sourceContentHash: null,
    sourcePathDigest: null,
  },
  updatedAt: "2026-10-02T00:00:00.000Z",
  repositoryHead: { commit: "b".repeat(40), observedAt: "2026-10-02T00:00:00.000Z" },
};

const observedAt = new Date("2026-10-02T06:00:00.000Z");
const stale = assessWorkstreamFreshness({
  snapshot: workstream,
  headDistance: { status: "measured", commitsBehind: 40 },
  observedAt,
});
const current = assessWorkstreamFreshness({
  snapshot: workstream,
  headDistance: { status: "measured", commitsBehind: 1 },
  observedAt,
});

function report(freshness: typeof stale) {
  return createOperatingAttentionReport({
    projectId: "prj_0123456789abcdef",
    workstream,
    workstreamFreshness: freshness,
    canonicalization: { coverage: "complete", candidates: [] },
    knowledgeLifecycle: { coverage: "cached", issues: [] },
    observedAt,
  });
}

describe("stale workstream attention", () => {
  it("projects stale items as non-blocking agent re-verification with consequence classes", () => {
    const projected = report(stale);
    expect(projected.summary).toMatchObject({
      blockingCount: 0,
      userActionCount: 0,
      staleCount: 3,
    });
    for (const item of projected.items) {
      expect(item).toMatchObject({
        state: "stale",
        blocking: false,
        requiresUserAction: false,
        actionOwner: "agent",
      });
      expect(item.instruction).toContain("Re-verify against the repository before acting");
    }
    expect(projected.items.find((item) => item.kind === "workstream_approval")).toMatchObject({
      consequence: "deployment",
    });
    expect(projected.items.find((item) => item.kind === "workstream_decision")).toMatchObject({
      consequence: "unclassified",
    });
    expect(report(current).items.find((item) => item.kind === "workstream_approval")).toMatchObject(
      { state: "pending", blocking: true, requiresUserAction: true, actionOwner: "user" },
    );
  });

  it("never renders a stale consequential approval or decision as a retrieval directive", () => {
    const context = formatTerminalAttentionContext(report(stale));
    expect(context).not.toContain(RISKY_SUMMARY);
    expect(context).not.toContain(RISKY_QUESTION);
    expect(context).not.toContain("present its bounded question or approval");
    expect(context).toContain(
      "3 stale workstream items need re-verification: `lervo workstream current`.",
    );
    const currentContext = formatTerminalAttentionContext(report(current));
    expect(currentContext).toContain(RISKY_SUMMARY);
    expect(currentContext).toContain(
      "For a listed current blocking item with owner=user, present its bounded question or approval in this turn",
    );
  });

  it("withholds stale consequential text from the full workstream context", () => {
    const full = formatWorkstreamContext(workstream, stale);
    expect(full).toContain("Freshness: stale (commits_behind");
    expect(full).toContain("decision wdec_0123456789abcdef: text withheld");
    expect(full).toContain("approval wapr_0123456789abcdef: deployment; text withheld");
    expect(full).not.toContain(RISKY_SUMMARY);
    expect(full).not.toContain(RISKY_QUESTION);
    expect(full).not.toContain("[blocking]");
    expect(formatWorkstreamContext(workstream, current)).toContain(RISKY_SUMMARY);
  });

  it("excludes stale items from the compact preamble and shows only a count", () => {
    const attention = report(stale);
    const preamble = formatCompactTerminalPreamble({
      attention,
      declarationInstruction: "Declare.",
      backgroundKnowledgeActive: true,
      workstreamPresent: true,
      staleWorkstreamEntryCount: 4,
    });
    expect(preamble).not.toContain("Blocking attention");
    expect(preamble).toContain(
      "4 stale workstream items need re-verification: `lervo workstream current`.",
    );
    const compact = formatCompactWorkstreamContext(workstream, stale);
    expect(compact.context).not.toContain("Re-enable the campaign.");
    expect(compact.context).not.toContain(RISKY_QUESTION);
    expect(compact.context).not.toContain("[blocking]");
    expect(formatCompactWorkstreamContext(workstream, current).context).toContain("[blocking]");
  });

  it("caps the whole compact context with a deterministic marker and honest byte counts", () => {
    const preambleWith = (declarationInstruction: string) =>
      formatCompactTerminalPreamble({
        attention: report(current),
        declarationInstruction,
        backgroundKnowledgeActive: false,
        workstreamPresent: true,
        staleWorkstreamEntryCount: 0,
      });
    // Leave about 300 bytes for the workstream so it must be truncated, not dropped.
    const preamble = preambleWith(
      "D".repeat(MAXIMUM_COMPACT_CONTEXT_BYTES - 300 - Buffer.byteLength(preambleWith(""))),
    );
    const workstreamContext = formatCompactWorkstreamContext(
      { ...workstream, title: "T".repeat(200) },
      current,
    );
    const first = assembleCompactTerminalContext(preamble, workstreamContext);
    const second = assembleCompactTerminalContext(preamble, workstreamContext);
    expect(first).toEqual(second);
    expect(Buffer.byteLength(first.additionalContext)).toBeLessThanOrEqual(
      MAXIMUM_COMPACT_CONTEXT_BYTES,
    );
    expect(first.additionalContext).toContain("[Lervo context truncated at");
    expect(first.workstream?.deliveredByteCount).toBe(
      Buffer.byteLength(first.workstream?.context ?? ""),
    );
    expect(first.additionalContext.endsWith(first.workstream?.context ?? "")).toBe(true);
    const oversized = assembleCompactTerminalContext("P".repeat(10_000), workstreamContext);
    expect(oversized.workstream).toBeNull();
    expect(Buffer.byteLength(oversized.additionalContext)).toBeLessThanOrEqual(
      MAXIMUM_COMPACT_CONTEXT_BYTES,
    );
  });

  it("caps the retrieval attention section", () => {
    const many = report(current);
    const long = {
      ...many,
      items: Array.from({ length: 12 }, (_, index) => ({
        ...many.items[0]!,
        itemId: `item_${index}`,
        summary: "S".repeat(1_000),
      })),
    } as typeof many;
    const context = formatTerminalAttentionContext(long);
    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(MAXIMUM_TERMINAL_ATTENTION_BYTES);
    expect(context).toMatch(/\[Lervo context truncated at 4096 bytes;/u);
  });
});
