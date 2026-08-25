import { randomUUID } from "node:crypto";

import {
  applyKnowledgeInstructionBootstrapPlan,
  createKnowledgeInstructionBootstrapPlan,
  serializableKnowledgeInstructionBootstrapPlan,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";

import type { CliIo } from "./types.js";

export async function runInstructionBootstrapStage(input: {
  repositoryRoot: string;
  supplementalSources: RepositorySupplementalSource[];
  applyPlanId?: string;
  approvalItems: string[];
  json: boolean;
  io: CliIo;
}): Promise<number | null> {
  const plan = await createKnowledgeInstructionBootstrapPlan({
    repositoryRoot: input.repositoryRoot,
    supplementalSources: input.supplementalSources,
  });
  if (plan.status === "not_applicable") return null;
  if (input.applyPlanId === undefined) {
    if (input.approvalItems.length > 0)
      throw new Error("--approve-item must be used with --apply.");
    input.io.stdout(
      input.json
        ? `${JSON.stringify(serializableKnowledgeInstructionBootstrapPlan(plan), null, 2)}\n`
        : plan.status === "blocked"
          ? `Canonical instruction bootstrap is blocked.\nreason: ${plan.blocker}\nNo instruction bytes were changed.\n`
          : `Canonical instruction adoption review plan created.\nplan: ${plan.planId}\nsource: CLAUDE.md · ${plan.source.contentHash}\ncanonical: AGENTS.md · ${plan.canonical.afterHash}\napproval: ${plan.operationId}=${plan.approvalHash}\nCLAUDE.md and unrelated documents have not been changed.\n`,
    );
    return plan.status === "blocked" ? 1 : 0;
  }
  if (plan.status === "blocked")
    throw new Error(`Canonical instruction bootstrap is blocked (${plan.blocker}).`);
  if (input.applyPlanId !== plan.planId)
    throw new Error(
      "The requested plan ID does not match the canonical instruction bootstrap plan.",
    );
  if (input.approvalItems.length !== 1)
    throw new Error("Canonical instruction adoption requires one exact --approve-item value.");
  const approval = /^(kinstbootop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/u.exec(
    input.approvalItems[0]!,
  );
  if (approval === null)
    throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    if (
      storage.events
        .list()
        .some(
          (event) =>
            event.type === "knowledge.materialization.applied" &&
            event.payload.planId === plan.planId,
        )
    )
      throw new Error("The same canonical instruction bootstrap plan was already applied.");
    const identity = randomUUID().replaceAll("-", "");
    const receipt = await applyKnowledgeInstructionBootstrapPlan({
      plan,
      approvedOperationId: approval[1]!,
      approvedHash: approval[2]!,
      now: new Date(),
      supplementalSources: input.supplementalSources,
      recordApplied: (applied) => {
        storage.events.append({
          eventId: `evt_${identity}`,
          projectId: applied.projectId,
          runId: `run_${identity}`,
          sessionId: `ses_${identity}`,
          type: "knowledge.materialization.applied",
          occurredAt: applied.appliedAt,
          actor: { kind: "user" },
          schemaVersion: 1,
          policyVersion: plan.policyHash,
          payload: {
            operation: "instruction_canonical_adoption",
            planId: applied.planId,
            sourceSnapshotId: applied.sourceSnapshotId,
            policyHash: plan.policyHash,
            compilerId: "lervo.instruction-bootstrap",
            compilerVersion: "1",
            approvalDigest: applied.approvalHash,
            coverage: plan.coverage,
            bundleIds: [],
            createdConceptIds: [],
            updatedConceptIds: [],
            deprecatedConceptIds: [],
            conceptListTruncated: false,
            resultArtifactId: null,
            resultArtifactHash: null,
            createdCount: 1,
            updatedCount: 0,
            unchangedCount: 0,
            beforeRegistryDigest: null,
            afterRegistryDigest: null,
            validationReportId: null,
            validationReportHash: null,
            appliedAt: applied.appliedAt,
          },
        });
      },
    });
    input.io.stdout(
      input.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `Adopted CLAUDE.md as canonical AGENTS.md instructions.\nplan: ${receipt.planId}\nRun lervo migrate knowledge again for provider-bridge disposition.\n`,
    );
  } finally {
    await storage.close();
  }
  return 0;
}
