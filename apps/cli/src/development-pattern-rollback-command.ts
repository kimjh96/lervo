import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { openProjectStorage } from "@lervo/project-storage";
import {
  applyDevelopmentPatternRollback,
  createDevelopmentPatternRollbackPlan,
  publicDevelopmentPatternRollbackPlan,
  sha256,
  stableId,
  type DevelopmentPatternCandidate,
} from "@lervo/repository-knowledge";
import { resolveRoleContract, RoleContractError } from "@lervo/roles";

import {
  allPatternEvents,
  appendPatternEvent,
  patternArtifactId,
  patternArtifactJson,
  patternArtifactText,
  projectPatterns,
  writePatternProjection,
} from "./development-pattern-storage.js";
import type { CliIo } from "./types.js";

async function assertRestoredRole(input: {
  repositoryRoot: string;
  candidate: DevelopmentPatternCandidate;
  restoredContent: string | null;
}): Promise<void> {
  const roleId = (JSON.parse(input.candidate.target.content) as { roleId: string }).roleId;
  if (input.restoredContent !== null) {
    const restored = await resolveRoleContract(input.repositoryRoot, roleId);
    if (restored.sourcePath !== input.candidate.target.path)
      throw new Error("The restored role profile does not resolve from its exact target.");
    return;
  }
  try {
    await resolveRoleContract(input.repositoryRoot, roleId);
  } catch (error) {
    if (error instanceof RoleContractError && error.code === "role_not_found") return;
    throw error;
  }
  throw new Error("The created agent profile still resolves after rollback.");
}

export async function runDevelopmentPatternRollbackCommand(
  args: string[],
  io: CliIo,
): Promise<number> {
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
    throw new Error("Agent-profile rollback requires one pattern ID.");
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const pattern = projectPatterns(allPatternEvents(storage)).find(
      (item) => item.patternId === parsed.positionals[0],
    );
    if (pattern?.candidateContentHash === null || pattern?.candidateContentHash === undefined)
      throw new Error("Agent-profile pattern candidate was not found.");
    if (pattern.targetKind !== "agent_profile")
      throw new Error("Only an agent-profile pattern has an explicit rollback route.");
    if (
      pattern.previousTargetContentHash !== null &&
      pattern.previousTargetArtifactId !== patternArtifactId(pattern.previousTargetContentHash)
    )
      throw new Error("The previous agent-profile target artifact binding is invalid.");
    const candidate = await patternArtifactJson<DevelopmentPatternCandidate>(
      storage,
      pattern.candidateContentHash,
    );
    const previousTargetContent =
      pattern.previousTargetContentHash === null
        ? null
        : await patternArtifactText(storage, pattern.previousTargetContentHash);
    const plan = await createDevelopmentPatternRollbackPlan({
      repositoryRoot,
      projectId: storage.manifest.projectId,
      patternState: pattern.state,
      candidate,
      candidateContentHash: pattern.candidateContentHash,
      previousTargetContentHash: pattern.previousTargetContentHash,
      previousTargetContent,
    });
    if (!parsed.values.apply) {
      io.stdout(
        `${parsed.values.json ? JSON.stringify(publicDevelopmentPatternRollbackPlan(plan), null, 2) : `Agent-profile rollback: ${plan.status}; plan ${plan.planId}.`}\n`,
      );
      return plan.status === "blocked" ? 1 : 0;
    }
    const rolledBackAt = new Date().toISOString();
    const receipt = {
      schemaVersion: 1,
      receiptKind: "agent_profile_rolled_back",
      planId: plan.planId,
      patternId: plan.patternId,
      restoredContentHash: plan.restoredContentHash,
      rolledBackAt,
    };
    await applyDevelopmentPatternRollback({
      plan,
      approval: parsed.values.approval ?? "",
      receipt,
      recordApplied: async () => {
        if (pattern.state === "rolled_back") return;
        await assertRestoredRole({
          repositoryRoot,
          candidate,
          restoredContent: plan.restoredContent,
        });
        appendPatternEvent(storage, {
          type: "development.pattern.transitioned",
          occurredAt: rolledBackAt,
          payload: {
            transitionId: stableId("dptr", {
              patternId: pattern.patternId,
              state: "rolled_back",
              rolledBackAt,
            }),
            patternId: pattern.patternId,
            fromState: "promoted",
            toState: "rolled_back",
            candidateArtifactId: pattern.candidateArtifactId,
            candidateContentHash: pattern.candidateContentHash,
            reviewArtifactId: pattern.reviewArtifactId,
            reviewContentHash: pattern.reviewContentHash,
            supersededByPatternId: pattern.supersededByPatternId,
            targetKind: pattern.targetKind,
            previousTargetArtifactId: pattern.previousTargetArtifactId,
            previousTargetContentHash: pattern.previousTargetContentHash,
            approvalHash: sha256(plan.planId),
            occurredAt: rolledBackAt,
          },
        });
      },
    });
    await writePatternProjection(repositoryRoot, projectPatterns(allPatternEvents(storage)));
    io.stdout(
      `${parsed.values.json ? JSON.stringify(receipt, null, 2) : `Rolled back agent-profile pattern ${receipt.patternId}.`}\n`,
    );
    return 0;
  } finally {
    await storage.close();
  }
}
