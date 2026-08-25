import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { openProjectStorage } from "@lervo/project-storage";
import {
  applyDevelopmentPatternPromotion,
  canonicalJson,
  createDevelopmentPatternCandidate,
  createDevelopmentPatternPromotionPlan,
  createDevelopmentPatternReview,
  publicDevelopmentPatternPromotionPlan,
  scanConfiguredRepositoryKnowledge,
  sha256,
  stableId,
  type DevelopmentPatternCandidate,
  type DevelopmentPatternProposal,
  type DevelopmentPatternReview,
} from "@lervo/repository-knowledge";

import {
  allPatternEvents,
  appendPatternEvent,
  patternArtifactId,
  patternArtifactJson,
  projectPatterns,
  writePatternProjection,
} from "./development-pattern-storage.js";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliIo } from "./types.js";

export const developmentPatternUsage = `  lervo knowledge pattern propose --provider <codex|claude> (--from <json-path>|--stdin) [--root <path>] [--json]
  lervo knowledge pattern status [<pattern-id>] [--root <path>] [--json]
  lervo knowledge pattern review <pattern-id> --decision <accept|reject|defer|supersede> --reviewer <id> --approval <candidate-hash> [--superseded-by <pattern-id>] [--root <path>] [--json]
  lervo knowledge pattern promote <pattern-id> [--apply --approval <plan-id>] [--root <path>] [--json]`;

async function readInput(parsed: ReturnType<typeof parseArgs>, io: CliIo): Promise<unknown> {
  if (parsed.values.from !== undefined && parsed.values.stdin)
    throw new Error("Specify only one of --from or --stdin.");
  if (parsed.values.from !== undefined)
    return JSON.parse(await readFile(resolve(io.cwd, String(parsed.values.from)), "utf8"));
  if (parsed.values.stdin && io.stdin) return JSON.parse(await io.stdin());
  throw new Error("A proposal requires --from or --stdin.");
}

async function propose(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      provider: { type: "string" },
      from: { type: "string" },
      stdin: { type: "boolean" },
      root: { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (!["codex", "claude"].includes(parsed.values.provider ?? ""))
    throw new Error("Pattern proposal provider must be codex or claude.");
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
  const { scan } = await scanConfiguredRepositoryKnowledge(repositoryRoot, { supplementalSources });
  const result = createDevelopmentPatternCandidate({
    proposal: (await readInput(parsed, io)) as DevelopmentPatternProposal,
    scan,
  });
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const stored = await storage.artifacts.put(result.content);
    if (stored.contentHash !== result.contentHash)
      throw new Error("Pattern candidate CAS mismatch.");
    const now = new Date().toISOString();
    const current = projectPatterns(allPatternEvents(storage)).find(
      (item) => item.patternId === result.candidate.patternId,
    );
    appendPatternEvent(storage, {
      type: "development.pattern.observed",
      occurredAt: now,
      payload: {
        patternId: result.candidate.patternId,
        observationId: stableId("dpobs", {
          patternId: result.candidate.patternId,
          provider: parsed.values.provider,
          observedAt: now,
        }),
        provider: parsed.values.provider,
        sourceSnapshotId: result.candidate.sourceSnapshotId,
        sourceSnapshotHash: result.candidate.sourceSnapshotHash,
        evidenceDigest: sha256(
          canonicalJson(result.candidate.occurrences.map((item) => item.evidenceDigest)),
        ),
        occurrenceCount: result.candidate.occurrences.length,
        observedAt: now,
      },
    });
    if (current === undefined) {
      appendPatternEvent(storage, {
        type: "development.pattern.transitioned",
        occurredAt: now,
        payload: {
          transitionId: stableId("dptr", {
            patternId: result.candidate.patternId,
            to: "candidate",
          }),
          patternId: result.candidate.patternId,
          fromState: "observed",
          toState: "candidate",
          candidateArtifactId: patternArtifactId(result.contentHash),
          candidateContentHash: result.contentHash,
          reviewArtifactId: null,
          reviewContentHash: null,
          targetKind: result.candidate.target.kind,
          approvalHash: null,
          occurredAt: now,
        },
      });
    } else if (current.candidateContentHash !== result.contentHash) {
      throw new Error("Pattern identity collision with different candidate bytes.");
    }
    const patterns = projectPatterns(allPatternEvents(storage));
    await writePatternProjection(repositoryRoot, patterns);
    const output = patterns.find((item) => item.patternId === result.candidate.patternId)!;
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(output, null, 2)}\n`
        : `Development pattern ${output.patternId}: ${output.state}; provider observations ${output.providers.join(", ")}. Repetition is not approval.\n`,
    );
    return 0;
  } finally {
    await storage.close();
  }
}

async function status(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: { root: { type: "string" }, json: { type: "boolean" } },
  });
  if (parsed.positionals.length > 1) throw new Error("Pattern status accepts at most one ID.");
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const patterns = projectPatterns(allPatternEvents(storage)).filter(
      (item) => parsed.positionals[0] === undefined || item.patternId === parsed.positionals[0],
    );
    await writePatternProjection(repositoryRoot, patterns);
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ schemaVersion: 1, patterns }, null, 2)}\n`
        : `${patterns.map((item) => `${item.patternId}: ${item.state}; providers ${item.providers.join(", ") || "none"}`).join("\n")}${patterns.length === 0 ? "No development patterns.\n" : "\n"}`,
    );
    return 0;
  } finally {
    await storage.close();
  }
}

async function review(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      decision: { type: "string" },
      reviewer: { type: "string" },
      approval: { type: "string" },
      "superseded-by": { type: "string" },
      root: { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (parsed.positionals.length !== 1) throw new Error("Pattern review requires one pattern ID.");
  if (!(["accept", "reject", "defer", "supersede"] as unknown[]).includes(parsed.values.decision))
    throw new Error("Pattern review decision is invalid.");
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const pattern = projectPatterns(allPatternEvents(storage)).find(
      (item) => item.patternId === parsed.positionals[0],
    );
    if (pattern?.candidateContentHash === null || pattern?.candidateContentHash === undefined)
      throw new Error("Pattern candidate was not found.");
    if (parsed.values.approval !== pattern.candidateContentHash)
      throw new Error("Review approval must equal the exact candidate content hash.");
    if (!["candidate", "deferred"].includes(pattern.state))
      throw new Error("The pattern is not reviewable from its current state.");
    const now = new Date().toISOString();
    const result = createDevelopmentPatternReview({
      patternId: pattern.patternId,
      candidateContentHash: pattern.candidateContentHash,
      decision: parsed.values.decision as DevelopmentPatternReview["decision"],
      reviewer: parsed.values.reviewer ?? "",
      ...(parsed.values["superseded-by"] === undefined
        ? {}
        : { supersededByPatternId: parsed.values["superseded-by"] }),
      reviewedAt: now,
    });
    const stored = await storage.artifacts.put(result.content);
    if (stored.contentHash !== result.contentHash) throw new Error("Pattern review CAS mismatch.");
    const common = {
      patternId: pattern.patternId,
      candidateArtifactId: pattern.candidateArtifactId,
      candidateContentHash: pattern.candidateContentHash,
      reviewArtifactId: patternArtifactId(result.contentHash),
      reviewContentHash: result.contentHash,
      targetKind: pattern.targetKind,
      approvalHash: sha256(pattern.candidateContentHash),
      occurredAt: now,
    };
    appendPatternEvent(storage, {
      type: "development.pattern.transitioned",
      occurredAt: now,
      payload: {
        ...common,
        transitionId: stableId("dptr", { patternId: pattern.patternId, state: "reviewed", now }),
        fromState: pattern.state,
        toState: "reviewed",
      },
    });
    if (result.review.decision !== "accept")
      appendPatternEvent(storage, {
        type: "development.pattern.transitioned",
        occurredAt: now,
        payload: {
          ...common,
          transitionId: stableId("dptr", {
            patternId: pattern.patternId,
            state: result.review.decision,
            now,
          }),
          fromState: "reviewed",
          toState:
            result.review.decision === "reject"
              ? "rejected"
              : result.review.decision === "defer"
                ? "deferred"
                : "superseded",
        },
      });
    const patterns = projectPatterns(allPatternEvents(storage));
    await writePatternProjection(repositoryRoot, patterns);
    const output = patterns.find((item) => item.patternId === pattern.patternId)!;
    io.stdout(
      `${parsed.values.json ? JSON.stringify(output, null, 2) : `Development pattern ${output.patternId}: ${output.state}.`}\n`,
    );
    return 0;
  } finally {
    await storage.close();
  }
}

async function promote(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      apply: { type: "boolean" },
      approval: { type: "string" },
      root: { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (parsed.positionals.length !== 1)
    throw new Error("Pattern promotion requires one pattern ID.");
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
  const { scan } = await scanConfiguredRepositoryKnowledge(repositoryRoot, { supplementalSources });
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const pattern = projectPatterns(allPatternEvents(storage)).find(
      (item) => item.patternId === parsed.positionals[0],
    );
    if (
      pattern?.candidateContentHash === null ||
      pattern?.candidateContentHash === undefined ||
      pattern.reviewContentHash === null
    )
      throw new Error("Accepted pattern review was not found.");
    if (!["reviewed", "promoted"].includes(pattern.state))
      throw new Error("The pattern is not promotable from its current state.");
    const candidate = await patternArtifactJson<DevelopmentPatternCandidate>(
      storage,
      pattern.candidateContentHash,
    );
    const reviewRecord = await patternArtifactJson<DevelopmentPatternReview>(
      storage,
      pattern.reviewContentHash,
    );
    const plan = await createDevelopmentPatternPromotionPlan({
      repositoryRoot,
      projectId: storage.manifest.projectId,
      candidate,
      candidateContentHash: pattern.candidateContentHash,
      review: reviewRecord,
      reviewContentHash: pattern.reviewContentHash,
      currentScan: scan,
    });
    if (!parsed.values.apply) {
      const output = publicDevelopmentPatternPromotionPlan(plan);
      io.stdout(
        `${parsed.values.json ? JSON.stringify(output, null, 2) : `Development-pattern promotion: ${plan.status}; plan ${plan.planId}.`}\n`,
      );
      return plan.status === "blocked" ? 1 : 0;
    }
    const now = new Date().toISOString();
    const receipt = {
      schemaVersion: 1,
      receiptKind: "development_pattern_promoted",
      planId: plan.planId,
      patternId: plan.patternId,
      changedFiles: plan.operations.filter((item) => item.action !== "unchanged").length,
      promotedAt: now,
    };
    await applyDevelopmentPatternPromotion({
      plan,
      approval: parsed.values.approval ?? "",
      receipt,
      recordApplied: () => {
        if (pattern.state === "promoted") return;
        appendPatternEvent(storage, {
          type: "development.pattern.transitioned",
          occurredAt: now,
          payload: {
            transitionId: stableId("dptr", {
              patternId: pattern.patternId,
              state: "promoted",
              now,
            }),
            patternId: pattern.patternId,
            fromState: "reviewed",
            toState: "promoted",
            candidateArtifactId: pattern.candidateArtifactId,
            candidateContentHash: pattern.candidateContentHash,
            reviewArtifactId: pattern.reviewArtifactId,
            reviewContentHash: pattern.reviewContentHash,
            targetKind: pattern.targetKind,
            approvalHash: sha256(plan.planId),
            occurredAt: now,
          },
        });
      },
    });
    await writePatternProjection(repositoryRoot, projectPatterns(allPatternEvents(storage)));
    io.stdout(
      `${parsed.values.json ? JSON.stringify(receipt, null, 2) : `Promoted development pattern ${receipt.patternId}; changed ${receipt.changedFiles} files.`}\n`,
    );
    return 0;
  } finally {
    await storage.close();
  }
}

export async function runDevelopmentPatternCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const action = args[0];
    if (action === "propose") return await propose(args.slice(1), io);
    if (action === "status") return await status(args.slice(1), io);
    if (action === "review") return await review(args.slice(1), io);
    if (action === "promote") return await promote(args.slice(1), io);
    throw new Error("Specify pattern propose, status, review, or promote.");
  } catch (error) {
    io.stderr(
      `${error instanceof Error ? error.message : String(error)}\n${developmentPatternUsage}\n`,
    );
    return 1;
  }
}
