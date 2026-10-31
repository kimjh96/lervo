import type { OperatingAttentionItemV1 } from "@lervo/application-contract";
import { describe, expect, it } from "vitest";
import { attributeOperatingAttention } from "../src/operating-attention-ownership.js";
import { healthNow } from "./repository-health-fixture.js";

const base = {
  schemaVersion: 1 as const,
  actionOwner: "user" as const,
  requiresUserAction: true,
  blocking: false,
  instruction: "Tell the owner to review this upkeep.",
};

describe("attention authority at consequential effects", () => {
  const items = {
    workstream_approval: {
      ...base,
      kind: "workstream_approval",
      state: "pending",
      itemId: "approval",
      approvalId: "approval",
      approvalKind: "deployment",
      consequence: "deployment",
      summary: "Deploy",
      bindingHash: `sha256:${"a".repeat(64)}`,
    },
    workstream_decision: {
      ...base,
      kind: "workstream_decision",
      state: "pending",
      itemId: "decision",
      decisionId: "decision",
      consequence: "unclassified",
      question: "Review?",
      choices: [],
      recommendedChoiceId: null,
    },
    workstream_blocker: {
      ...base,
      kind: "workstream_blocker",
      state: "blocked",
      itemId: "blocker",
      blockerIndex: 0,
      summary: "Blocked",
    },
    canonicalization_review: {
      ...base,
      kind: "canonicalization_review",
      state: "pending",
      itemId: "canon",
      candidateId: "canon",
      candidateHash: `sha256:${"a".repeat(64)}`,
      sourcePaths: [],
      responsibilities: [],
      recommendedRoots: [],
      outcomeKind: null,
      proposedTargetPaths: [],
      hasProposedContent: false,
      createdAt: healthNow.toISOString(),
    },
    knowledge_lifecycle: {
      ...base,
      kind: "knowledge_lifecycle",
      state: "action_required",
      itemId: "lifecycle",
      issueCode: "review_required",
      detail: null,
    },
    repository_replica_divergence: {
      ...base,
      kind: "repository_replica_divergence",
      state: "action_required",
      itemId: "replica",
      replicaId: "replica",
      divergenceId: "divergence",
      reason: "conflicting_paths",
      conflictPathCount: 1,
      conflictPaths: ["README.md"],
      openedAt: healthNow.toISOString(),
    },
    document_freshness_candidate: {
      ...base,
      kind: "document_freshness_candidate",
      state: "verified_pending_cross_check",
      itemId: "freshness",
      candidateId: "freshness",
      documentPath: "README.md",
      priorityClass: "canonical",
      changeClasses: ["statement"],
      hunkCount: 1,
      ownerConsequence: null,
    },
    document_freshness_applied: {
      ...base,
      kind: "document_freshness_applied",
      state: "applied",
      itemId: "applied",
      candidateId: "applied",
      documentPath: "README.md",
      approvalSource: "lervo_managed",
      commitHash: null,
      revertInstruction: "revert",
    },
    document_freshness_blocked: {
      ...base,
      kind: "document_freshness_blocked",
      state: "action_required",
      itemId: "blocked",
      reasonCode: "zero_success_window",
      documentPath: null,
      attempts: 5,
    },
    durable_instruction_candidate: {
      ...base,
      kind: "durable_instruction_candidate",
      state: "waiting_authority",
      itemId: "instruction",
      candidateId: "instruction",
      candidateHash: `sha256:${"a".repeat(64)}`,
      captureSource: "conversation",
      title: "Rule",
      targetPath: "AGENTS.md",
    },
    captured_decision: {
      ...base,
      kind: "captured_decision",
      state: "action_required",
      itemId: "capture",
      captureId: "capture",
      captureSource: "conversation",
      title: "Settled",
      capturedAt: healthNow.toISOString(),
    },
    instruction_capture_blocked: {
      ...base,
      kind: "instruction_capture_blocked",
      state: "action_required",
      itemId: "capture_blocked",
      reasonCode: "knowledge_authority_unavailable",
      queuedCount: 1,
      since: healthNow.toISOString(),
    },
    knowledge_convergence_owner: {
      ...base,
      kind: "knowledge_convergence_owner",
      state: "action_required",
      itemId: "owner",
      role: "unverifiable",
      reason: "offline",
      failureCode: "hub_unreachable",
      httpStatus: null,
      holderLabel: null,
      observedAt: healthNow.toISOString(),
    },
    knowledge_publication: {
      ...base,
      kind: "knowledge_publication",
      state: "action_required",
      itemId: "publication",
      failureCode: "knowledge_publication_checks_failed",
      detail: null,
      pullRequestUrl: null,
      occurrences: 1,
      firstObservedAt: healthNow.toISOString(),
    },
    knowledge_convergence_continuity: {
      ...base,
      kind: "knowledge_convergence_continuity",
      state: "observed",
      itemId: "continuity",
      findingCode: "resident_missing",
      severity: "attention",
      detail: null,
      observedAt: healthNow.toISOString(),
    },
  } satisfies Record<OperatingAttentionItemV1["kind"], OperatingAttentionItemV1>;

  it.each([
    ["workstream_approval", "owner", true],
    ["workstream_decision", "principal proxy", false],
    ["workstream_blocker", "working agent", false],
    ["canonicalization_review", "canonical reviewer", false],
    ["knowledge_lifecycle", "resident", false],
    ["repository_replica_divergence", "owner", true],
    ["document_freshness_candidate", "resident freshness cycle", false],
    ["document_freshness_applied", "resident freshness cycle", false],
    ["document_freshness_blocked", "resident freshness cycle", false],
    ["durable_instruction_candidate", "instruction reviewer", false],
    ["captured_decision", "principal proxy", false],
    ["instruction_capture_blocked", "owner", true],
    ["knowledge_convergence_owner", "resident", false],
    ["knowledge_publication", "knowledge publisher", false],
    ["knowledge_convergence_continuity", "resident", false],
  ] as const)("classifies %s through structured effects", (kind, actor, requiresUserAction) => {
    expect(attributeOperatingAttention(items[kind], healthNow)).toMatchObject({
      requiresUserAction,
      attribution: { actor, requiresUserAction },
    });
  });

  it.each([
    ["hub_forbidden", "authority_scope"],
    ["hub_unauthorized", "credentials"],
    ["token_file_unreadable", "credentials"],
  ])("retains consequential %s recovery for the owner", (failureCode, consequence) => {
    expect(
      attributeOperatingAttention({ ...items.knowledge_convergence_owner, failureCode }, healthNow),
    ).toMatchObject({
      requiresUserAction: true,
      attribution: { actor: "owner", consequence, recommendation: base.instruction },
    });
  });

  it("keeps scope and exact write exceptions while preserving stale re-verification", () => {
    expect(
      attributeOperatingAttention(
        { ...items.knowledge_convergence_continuity, severity: "owner_decision" },
        healthNow,
      ).requiresUserAction,
    ).toBe(true);
    expect(
      attributeOperatingAttention(
        { ...items.knowledge_lifecycle, issueCode: "turn_approval_pending" },
        healthNow,
      ).requiresUserAction,
    ).toBe(true);
    // A gh authentication failure needs the owner's login; other publication failures do not.
    expect(
      attributeOperatingAttention(
        { ...items.knowledge_publication, detail: "gh pr exit 1 auth" },
        healthNow,
      ),
    ).toMatchObject({ requiresUserAction: true, attribution: { consequence: "credentials" } });
    expect(
      attributeOperatingAttention(items.knowledge_publication, healthNow).requiresUserAction,
    ).toBe(false);
    const instruction = "Re-verify against the repository before acting.";
    expect(
      attributeOperatingAttention(
        { ...items.workstream_approval, state: "stale", instruction },
        healthNow,
      ),
    ).toMatchObject({ instruction, requiresUserAction: false, blocking: false });
  });
  it("attributes settled decisions and review chores to Lervo, retaining their source instructions", () => {
    const held: OperatingAttentionItemV1 = {
      ...base,
      kind: "captured_decision",
      itemId: "capture",
      state: "action_required",
      captureId: "capture",
      captureSource: "conversation",
      title: "Settled choice",
      capturedAt: "2026-10-30T02:00:00.000Z",
    };
    expect(attributeOperatingAttention(held, healthNow)).toMatchObject({
      actionOwner: "agent",
      requiresUserAction: false,
      recordedInstruction: base.instruction,
      attribution: { actor: "principal proxy", ageMilliseconds: 86_400_000, consequence: null },
    });
    const blocked: OperatingAttentionItemV1 = {
      ...base,
      kind: "document_freshness_blocked",
      itemId: "freshness",
      state: "action_required",
      reasonCode: "zero_success_window",
      documentPath: null,
      attempts: 5,
    };
    expect(attributeOperatingAttention(blocked, healthNow)).toMatchObject({
      requiresUserAction: false,
      attribution: { actor: "resident freshness cycle" },
    });
  });

  it("requires a structured consequential effect and never infers authority from review text", () => {
    const candidate: OperatingAttentionItemV1 = {
      ...base,
      kind: "document_freshness_candidate",
      itemId: "freshness",
      state: "verified_pending_cross_check",
      candidateId: "candidate",
      documentPath: "README.md",
      priorityClass: "canonical",
      changeClasses: ["statement"],
      hunkCount: 1,
      ownerConsequence: null,
    };
    expect(attributeOperatingAttention(candidate, healthNow).requiresUserAction).toBe(false);
    const effect = attributeOperatingAttention(
      { ...candidate, ownerConsequence: "repository_write" },
      healthNow,
    );
    expect(effect).toMatchObject({
      requiresUserAction: true,
      attribution: {
        actor: "owner",
        consequence: "repository_write",
        inspectCommand: "lervo knowledge freshness review candidate",
      },
    });
    const scope: OperatingAttentionItemV1 = {
      ...base,
      kind: "instruction_capture_blocked",
      itemId: "authority",
      state: "action_required",
      reasonCode: "knowledge_authority_unavailable",
      queuedCount: 1,
      since: "2026-10-30T02:00:00.000Z",
    };
    expect(attributeOperatingAttention(scope, healthNow).attribution).toMatchObject({
      consequence: "authority_scope",
      inspectCommand: "lervo knowledge convergence doctor --json",
    });
  });
});
