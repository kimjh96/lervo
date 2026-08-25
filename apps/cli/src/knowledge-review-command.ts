import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import {
  calculateKnowledgeReconciliationReviewPolicyVersion,
  createKnowledgeReconciliationPlan,
  loadKnowledgeReconciliationReviewPolicy,
  reviewKnowledgeReconciliation,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { stringify } from "yaml";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliIo } from "./types.js";
import { knowledgeUsage } from "./knowledge-usage.js";

export async function runKnowledgeReviewPolicy(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        reviewer: { type: "string" },
        "policy-id": { type: "string" },
        "allow-conflict-resolution": { type: "boolean" },
        write: { type: "boolean" },
        json: { type: "boolean" },
      },
    });
    if (parsed.values.reviewer === undefined) throw new Error("--reviewer is required.");
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(parsed.values.reviewer))
      throw new Error("The reviewer ID format is invalid.");
    const policyId = parsed.values["policy-id"] ?? "knowledge_semantic_review.default";
    if (!/^knowledge_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(policyId))
      throw new Error("The policy ID format is invalid.");
    const conflictDisposition =
      parsed.values["allow-conflict-resolution"] === true
        ? ("hash_bound_resolution" as const)
        : ("skip_only" as const);
    const materials = {
      schemaVersion: 1 as const,
      policyId,
      allowedReviewerIds: [parsed.values.reviewer],
      requireCompleteDispositionReview: true as const,
      conflictDisposition,
    };
    const policy = {
      ...materials,
      policyVersion: calculateKnowledgeReconciliationReviewPolicyVersion(materials),
    };
    const content = `${stringify(policy, { lineWidth: 0, sortMapEntries: true })}`;
    const relativePath = `.lervo/knowledge/review-policies/${policyId}.yaml`;
    if (parsed.values.write) {
      const root = resolve(io.cwd, parsed.values.root ?? ".");
      const directory = resolve(root, ".lervo/knowledge/review-policies");
      try {
        await mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const directoryStats = await lstat(directory);
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink())
        throw new Error(
          "The review policy directory is not a safe physical directory. Run lervo init again first.",
        );
      let handle;
      try {
        handle = await open(
          resolve(root, relativePath),
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle?.close();
      }
    }
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ policy, path: relativePath, written: parsed.values.write === true }, null, 2)}\n`
        : `${parsed.values.write ? `Review policy created: ${relativePath}` : content}\n${parsed.values.write ? `policyVersion: ${policy.policyVersion}\n` : ""}`,
    );
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}

export async function runKnowledgeReview(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        plan: { type: "string" },
        policy: { type: "string" },
        reviewer: { type: "string" },
        "accept-all-safe": { type: "boolean" },
        "approve-item": { type: "string", multiple: true },
        "resolve-item": { type: "string", multiple: true },
        reject: { type: "boolean" },
        json: { type: "boolean" },
      },
    });
    if (
      parsed.positionals.length !== 1 ||
      parsed.values.plan === undefined ||
      parsed.values.policy === undefined ||
      parsed.values.reviewer === undefined
    )
      throw new Error("review requires a compilation ID plus --plan, --policy, and --reviewer.");
    const itemApprovals = (parsed.values["approve-item"] ?? []).map((value) => {
      const match = /^(kdisp_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(value);
      if (match === null)
        throw new Error("--approve-item must use <disposition-id>=<sha256-output-hash>.");
      return {
        dispositionId: match[1]!,
        action: "apply_managed_block_patch" as const,
        outputHash: match[2]!,
      };
    });
    const conflictResolutions = (parsed.values["resolve-item"] ?? []).map((value) => {
      const match = /^(kdisp_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(value);
      if (match === null)
        throw new Error("--resolve-item must use <disposition-id>=<sha256-resolution-hash>.");
      return {
        dispositionId: match[1]!,
        action: "resolve_conflict" as const,
        resolutionHash: match[2]!,
      };
    });
    const approvals = [...itemApprovals, ...conflictResolutions];
    const rejecting = parsed.values.reject === true;
    const approving = parsed.values["accept-all-safe"] === true || approvals.length > 0;
    if (rejecting === approving)
      throw new Error(
        "Choose either --accept-all-safe/--approve-item/--resolve-item approval or --reject.",
      );
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const compilationId = parsed.positionals[0] as string;
    const supplementalSources = await collectLocalKnowledgeSources(root);
    const [plan, policy] = await Promise.all([
      createKnowledgeReconciliationPlan({
        repositoryRoot: root,
        compilationId,
        supplementalSources,
      }),
      loadKnowledgeReconciliationReviewPolicy({
        repositoryRoot: root,
        policyPath: parsed.values.policy,
      }),
    ]);
    const safeIds =
      parsed.values["accept-all-safe"] === true
        ? plan.dispositions
            .filter((item) => item.action !== "conflict" && item.action !== "propose_user_patch")
            .map((item) => item.dispositionId)
        : [];
    const acceptedDispositionIds = rejecting
      ? []
      : [...new Set([...safeIds, ...approvals.map((item) => item.dispositionId)])];
    const skippedDispositionIds = plan.dispositions
      .filter((item) => !acceptedDispositionIds.includes(item.dispositionId))
      .map((item) => item.dispositionId);
    const storage = await openProjectStorage(root);
    try {
      const identity = randomUUID().replaceAll("-", "");
      const result = await reviewKnowledgeReconciliation({
        repositoryRoot: root,
        compilationId,
        reconciliationPlanId: parsed.values.plan,
        policy,
        reviewerId: parsed.values.reviewer,
        decision: rejecting ? "rejected" : "approved",
        acceptedDispositionIds,
        skippedDispositionIds,
        itemApprovals: approvals,
        reviewedAt: new Date(),
        runId: `run_${identity}`,
        sessionId: `ses_${identity}`,
        createEventId: () => `evt_${identity}`,
        artifacts: storage.artifacts,
        events: storage.events,
        supplementalSources,
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify({ review: result.review, artifact: result.artifact, eventId: result.eventId }, null, 2)}\n`
          : `Semantic reconciliation review recorded.\nreview: ${result.review.reviewId}\ndecision: ${result.review.decision} · accepted ${result.review.acceptedDispositionIds.length}, skipped ${result.review.skippedDispositionIds.length} · exact user-byte approvals ${result.review.itemApprovals.length}\nReviewer identity and approved paths and content remain only in the local CAS source; the event records digests only.\n`,
      );
    } finally {
      await storage.close();
    }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}
