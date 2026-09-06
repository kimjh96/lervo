import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { openProjectStorage } from "@lervo/project-storage";
import { resolveRoleContract, roleProfileHash } from "@lervo/roles";
import {
  applyDevelopmentPatternPromotion,
  createDevelopmentPatternCandidate,
  createDevelopmentPatternPromotionPlan,
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
import { recordDevelopmentPatternObservation } from "./development-pattern-observation.js";
import { runDevelopmentPatternReviewCommand } from "./development-pattern-review-command.js";
import { runDevelopmentPatternRollbackCommand } from "./development-pattern-rollback-command.js";
import { passedWorkflowVerificationEvidence } from "./development-pattern-verification.js";
import { roleProfileActivationEvidence } from "./agent-profile-evidence.js";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliIo } from "./types.js";

export const developmentPatternUsage = `  lervo knowledge pattern propose --provider <codex|claude> (--from <json-path>|--stdin) [--root <path>] [--json]
  lervo knowledge pattern status [<pattern-id>] [--root <path>] [--json]
  lervo knowledge pattern review <pattern-id> --decision <accept|reject|defer|supersede> --reviewer <id> --approval <candidate-hash> [--superseded-by <pattern-id>] [--root <path>] [--json]
  lervo knowledge pattern promote <pattern-id> [--apply --approval <plan-id>] [--root <path>] [--json]
  lervo knowledge pattern rollback <pattern-id> [--apply --approval <plan-id>] [--root <path>] [--json]`;

async function readInput(parsed: ReturnType<typeof parseArgs>, io: CliIo): Promise<unknown> {
  if (parsed.values.from !== undefined && parsed.values.stdin)
    throw new Error("Specify only one of --from or --stdin.");
  if (parsed.values.from !== undefined)
    return JSON.parse(await readFile(resolve(io.cwd, String(parsed.values.from)), "utf8"));
  if (parsed.values.stdin && io.stdin) return JSON.parse(await io.stdin());
  throw new Error("A proposal requires --from or --stdin.");
}

async function propose(args: string[], io: CliIo, requiredTargetKind?: string): Promise<number> {
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
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const proposal = (await readInput(parsed, io)) as DevelopmentPatternProposal;
    if (requiredTargetKind !== undefined && proposal.target?.kind !== requiredTargetKind)
      throw new Error(`The pattern target must be ${requiredTargetKind}.`);
    const result = createDevelopmentPatternCandidate({
      proposal,
      scan,
      passedVerificationEvidence: passedWorkflowVerificationEvidence(storage),
      roleProfileActivationEvidence: roleProfileActivationEvidence(storage),
    });
    const now = new Date().toISOString();
    const output = await recordDevelopmentPatternObservation({
      repositoryRoot,
      storage,
      provider: parsed.values.provider as "codex" | "claude",
      ...result,
      observedAt: now,
    });
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

async function status(args: string[], io: CliIo, requiredTargetKind?: string): Promise<number> {
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
      (item) =>
        (requiredTargetKind === undefined || item.targetKind === requiredTargetKind) &&
        (parsed.positionals[0] === undefined || item.patternId === parsed.positionals[0]),
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

async function promote(args: string[], io: CliIo, requiredTargetKind?: string): Promise<number> {
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
    if (requiredTargetKind !== undefined && pattern.targetKind !== requiredTargetKind)
      throw new Error(`The pattern target must be ${requiredTargetKind}.`);
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
      passedVerificationEvidence: passedWorkflowVerificationEvidence(storage),
      roleProfileActivationEvidence: roleProfileActivationEvidence(storage),
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
      recordApplied: async () => {
        if (pattern.state === "promoted") return;
        let activatedRole:
          | {
              roleId: string;
              version: string;
              contractHash: string;
              profileHash: string;
            }
          | undefined;
        let previousTargetArtifactId: string | null = null;
        if (candidate.target.kind === "agent_profile") {
          const targetRoleId = (JSON.parse(candidate.target.content) as { roleId: string }).roleId;
          const contract = await resolveRoleContract(repositoryRoot, targetRoleId);
          if (contract.sourcePath !== candidate.target.path)
            throw new Error("The promoted agent profile did not resolve from its exact target.");
          activatedRole = {
            roleId: contract.roleId,
            version: contract.version,
            contractHash: contract.contractHash,
            profileHash: roleProfileHash(contract.definition.profile),
          };
          if (plan.rollbackTarget?.previousContent !== null && plan.rollbackTarget !== null) {
            const storedPrevious = await storage.artifacts.put(plan.rollbackTarget.previousContent);
            if (storedPrevious.contentHash !== plan.rollbackTarget.previousContentHash)
              throw new Error("The previous agent-profile target CAS binding changed.");
            previousTargetArtifactId = patternArtifactId(storedPrevious.contentHash);
          }
        }
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
            ...(candidate.target.kind === "agent_profile"
              ? {
                  previousTargetArtifactId,
                  previousTargetContentHash: plan.rollbackTarget?.previousContentHash ?? null,
                  activatedRoleId: activatedRole!.roleId,
                  activatedRoleVersion: activatedRole!.version,
                  activatedRoleContractHash: activatedRole!.contractHash,
                  activatedRoleProfileHash: activatedRole!.profileHash,
                }
              : {}),
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

export async function runDevelopmentPatternCommand(
  args: string[],
  io: CliIo,
  requiredTargetKind?: string,
): Promise<number> {
  try {
    const action = args[0];
    if (action === "propose") return await propose(args.slice(1), io, requiredTargetKind);
    if (action === "status") return await status(args.slice(1), io, requiredTargetKind);
    if (action === "review")
      return await runDevelopmentPatternReviewCommand(args.slice(1), io, requiredTargetKind);
    if (action === "promote") return await promote(args.slice(1), io, requiredTargetKind);
    if (action === "rollback") return await runDevelopmentPatternRollbackCommand(args.slice(1), io);
    throw new Error("Specify pattern propose, status, review, promote, or rollback.");
  } catch (error) {
    io.stderr(
      `${error instanceof Error ? error.message : String(error)}\n${developmentPatternUsage}\n`,
    );
    return 1;
  }
}
