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
      state: "lervo_debt",
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
      state: "lervo_debt",
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
      state: "lervo_debt",
      itemId: "freshness",
      candidateId: "freshness",
      documentPath: "README.md",
      priorityClass: "canonical",
      changeClasses: ["statement"],
      hunkCount: 1,
      heldReason: "cross_check_response_invalid",
      retryAt: null,
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
      state: "lervo_debt",
      itemId: "blocked",
      reasonCode: "zero_success_window",
      documentPath: null,
      attempts: 5,
      since: "2026-10-30T02:00:00.000Z",
      retryAt: "2026-10-30T03:00:00.000Z",
    },
    durable_instruction_candidate: {
      ...base,
      kind: "durable_instruction_candidate",
      state: "pending_apply",
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
      state: "lervo_debt",
      heldKind: "decision",
      itemId: "capture",
      captureId: "capture",
      captureSource: "conversation",
      title: "Settled",
      capturedAt: healthNow.toISOString(),
    },
    instruction_capture_blocked: {
      ...base,
      kind: "instruction_capture_blocked",
      state: "lervo_debt",
      itemId: "capture_blocked",
      reasonCode: "knowledge_authority_unavailable",
      queuedCount: 1,
      since: healthNow.toISOString(),
    },
    held_effect: {
      ...base,
      kind: "held_effect",
      state: "lervo_debt",
      itemId: "held",
      effect: "capability_install",
      subject: "tools/local-mcp@1.0.0",
      reasonCode: "stronger_check_disagreement",
      attempts: 1,
      since: healthNow.toISOString(),
    },
    git_index_lock_stale: {
      ...base,
      kind: "git_index_lock_stale",
      state: "action_required",
      itemId: "git_index_lock_stale",
      path: ".git/index.lock",
      ageSeconds: 3600,
      since: healthNow.toISOString(),
    },
    knowledge_convergence_owner: {
      ...base,
      kind: "knowledge_convergence_owner",
      state: "lervo_debt",
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
      state: "lervo_debt",
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
    ["workstream_approval", "working agent", false],
    ["workstream_decision", "principal proxy", false],
    ["workstream_blocker", "working agent", false],
    ["canonicalization_review", "canonical reviewer", false],
    ["knowledge_lifecycle", "resident", false],
    ["repository_replica_divergence", "replica coordinator", false],
    ["document_freshness_candidate", "resident freshness cycle", false],
    ["document_freshness_applied", "resident freshness cycle", false],
    ["document_freshness_blocked", "resident freshness cycle", false],
    ["durable_instruction_candidate", "knowledge resident", false],
    ["captured_decision", "knowledge resident", false],
    ["instruction_capture_blocked", "knowledge resident", false],
    ["held_effect", "capability installer", false],
    // Lervo never deletes a lock in the owner's repository, so removing it is the owner's step.
    ["git_index_lock_stale", "owner", true],
    ["knowledge_convergence_owner", "knowledge resident", false],
    ["knowledge_publication", "knowledge publisher", false],
    ["knowledge_convergence_continuity", "knowledge resident", false],
  ] as const)("classifies %s through structured effects", (kind, actor, requiresUserAction) => {
    expect(attributeOperatingAttention(items[kind], healthNow)).toMatchObject({
      requiresUserAction,
      attribution: { actor, requiresUserAction },
    });
  });

  it.each([
    [
      "hub_forbidden",
      "credentials",
      "Grant bounded workspace.read and workspace.coordinate for the configured Hub scope",
    ],
    [
      "hub_unauthorized",
      "credentials",
      "Replace the rejected Hub token for the configured project and destination",
    ],
    [
      "token_file_unreadable",
      "credentials",
      "Restore owner-only access to the configured Hub token file",
    ],
  ] as const)(
    "keeps the %s credential as the owner's notice-only recovery",
    (failureCode, consequence, recommendation) => {
      expect(
        attributeOperatingAttention(
          { ...items.knowledge_convergence_owner, failureCode },
          healthNow,
        ),
      ).toMatchObject({
        requiresUserAction: true,
        instruction: base.instruction,
        attribution: { actor: "owner", consequence, recommendation },
      });
    },
  );

  it("holds continuity and pending declarations as Lervo work while preserving stale re-verification", () => {
    // ADR-0561: continuity outside the policy limits is Lervo debt, never an owner decision.
    expect(
      attributeOperatingAttention(
        { ...items.knowledge_convergence_continuity, severity: "lervo_debt" },
        healthNow,
      ),
    ).toMatchObject({
      requiresUserAction: false,
      attribution: { actor: "knowledge resident", consequence: null },
    });
    // A stored pending_user_approval declaration waits on no one.
    expect(
      attributeOperatingAttention(
        { ...items.knowledge_lifecycle, issueCode: "turn_approval_pending" },
        healthNow,
      ).requiresUserAction,
    ).toBe(false);
    // ADR-0561: a reviewed layout plan is Lervo's own cross-checked work, never owner work.
    expect(
      attributeOperatingAttention(
        {
          ...items.knowledge_lifecycle,
          issueCode: "repository_layout_review_required",
          instruction: "lervo migrate knowledge",
        },
        healthNow,
      ),
    ).toMatchObject({ requiresUserAction: false, attribution: { consequence: null } });
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
      state: "lervo_debt",
      heldKind: "decision",
      captureId: "capture",
      captureSource: "conversation",
      title: "Settled choice",
      capturedAt: "2026-10-30T02:00:00.000Z",
    };
    expect(attributeOperatingAttention(held, healthNow)).toMatchObject({
      actionOwner: "agent",
      requiresUserAction: false,
      recordedInstruction: base.instruction,
      attribution: { actor: "knowledge resident", ageMilliseconds: 86_400_000, consequence: null },
    });
    // ADR-0561: freshness holds are Lervo debt with backoff, shown with their age.
    const blocked: OperatingAttentionItemV1 = {
      ...base,
      kind: "document_freshness_blocked",
      itemId: "freshness",
      state: "lervo_debt",
      reasonCode: "cross_check_disagreement_repeated",
      documentPath: "README.md",
      attempts: 1,
      since: "2026-10-30T02:00:00.000Z",
      retryAt: "2026-10-31T02:00:00.000Z",
    };
    expect(attributeOperatingAttention(blocked, healthNow)).toMatchObject({
      requiresUserAction: false,
      attribution: {
        actor: "resident freshness cycle",
        consequence: null,
        ageMilliseconds: 86_400_000,
      },
    });
  });

  it("requires a structured consequential effect and never infers authority from review text", () => {
    const candidate: OperatingAttentionItemV1 = {
      ...base,
      kind: "document_freshness_candidate",
      itemId: "freshness",
      state: "lervo_debt",
      candidateId: "candidate",
      documentPath: "README.md",
      priorityClass: "canonical",
      changeClasses: ["statement"],
      hunkCount: 1,
      heldReason: "cross_check_response_invalid",
      retryAt: null,
      instruction: "Review and approve this freshness candidate.",
    };
    expect(attributeOperatingAttention(candidate, healthNow)).toMatchObject({
      requiresUserAction: false,
      attribution: { inspectCommand: "lervo knowledge freshness review candidate" },
    });
    const lifecycle: OperatingAttentionItemV1 = {
      ...base,
      kind: "knowledge_lifecycle",
      itemId: "lifecycle",
      state: "action_required",
      issueCode: "turn_approval_pending",
      detail: null,
    };
    expect(attributeOperatingAttention(lifecycle, healthNow)).toMatchObject({
      requiresUserAction: false,
      attribution: { actor: "resident", consequence: null },
    });
    // ADR-0561: a missing delegation for capture is Lervo debt, never owner work.
    const scope: OperatingAttentionItemV1 = {
      ...base,
      kind: "instruction_capture_blocked",
      itemId: "authority",
      state: "lervo_debt",
      reasonCode: "knowledge_authority_unavailable",
      queuedCount: 1,
      since: "2026-10-30T02:00:00.000Z",
    };
    expect(attributeOperatingAttention(scope, healthNow)).toMatchObject({
      requiresUserAction: false,
      attribution: {
        actor: "knowledge resident",
        consequence: null,
        inspectCommand: "lervo knowledge convergence doctor --json",
      },
    });
  });
});
