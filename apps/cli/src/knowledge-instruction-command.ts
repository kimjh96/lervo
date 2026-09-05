import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
  applyKnowledgeInstructionBridgePlan,
  canonicalJson,
  createKnowledgeInstructionBridgePlan,
  lintRepositoryKnowledge,
  serializableKnowledgeInstructionBridgePlan,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliIo, CliServices } from "./types.js";
import { knowledgeUsage } from "./knowledge-usage.js";
import {
  instructionBridgeKnowledgeLintCodes,
  validateKnowledgeStage,
} from "./knowledge-stage-lint.js";
import { runKnowledgeDurableInstruction } from "./knowledge-durable-instruction-command.js";

export async function runKnowledgeInstruction(
  args: string[],
  io: CliIo,
  services?: Pick<CliServices, "groundProductionRequest">,
): Promise<number> {
  try {
    if (["intake", "status", "review"].includes(args[0] ?? ""))
      return await runKnowledgeDurableInstruction(args, io, services);
    if (args[0] !== "bridge") throw new Error("The instruction command currently supports bridge.");
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        provider: { type: "string" },
        apply: { type: "string" },
        "approve-item": { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (parsed.values.provider !== "claude")
      throw new Error("The first instruction bridge profile requires --provider claude.");
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
    const plan = await createKnowledgeInstructionBridgePlan({
      repositoryRoot,
      provider: "claude",
      supplementalSources,
    });
    if (parsed.values.apply === undefined) {
      if (parsed.values["approve-item"] !== undefined)
        throw new Error("--approve-item must be used with --apply.");
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(serializableKnowledgeInstructionBridgePlan(plan), null, 2)}\n`
          : plan.status === "current"
            ? `The Claude instruction bridge matches the current profile.\nprofile: ${plan.profile.profileId}\ncanonical: ${plan.canonical.path} · ${plan.canonical.contentHash}\ntarget: ${plan.target.path} · ${plan.target.afterHash}\n`
            : plan.status === "ready"
              ? `The Claude instruction bridge target is current; a derived record/navigation update plan was created.\nplan: ${plan.planId}\nprofile: ${plan.profile.profileId}\nUse --apply ${plan.planId} to apply. Item approval is not required.\n`
              : `Claude instruction bridge review plan created.\nplan: ${plan.planId}\noperation: ${plan.operationId}\nprofile: ${plan.profile.profileId}\ncanonical: ${plan.canonical.path} · ${plan.canonical.contentHash}\ntarget: ${plan.target.action} ${plan.target.path} · ${plan.target.beforeHash ?? "absent"} → ${plan.target.afterHash}\napproval: ${plan.operationId}=${plan.approvalHash}\nInstructions, bridge records, concepts, and navigation have not been changed.\n`,
      );
      return 0;
    }
    if (plan.status === "current")
      throw new Error("The instruction bridge is already current; there are no changes to apply.");
    if (parsed.values.apply !== plan.planId)
      throw new Error("The requested plan ID does not match the current instruction bridge plan.");
    const approval =
      parsed.values["approve-item"] === undefined
        ? null
        : /^(kinstop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(parsed.values["approve-item"]);
    if (plan.status === "review_required" && approval === null)
      throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
    if (plan.status === "ready" && parsed.values["approve-item"] !== undefined)
      throw new Error("Do not use --approve-item for a ready plan with no user-target change.");
    const baselineValidation = await lintRepositoryKnowledge(repositoryRoot, {
      supplementalSources,
    });
    const storage = await openProjectStorage(repositoryRoot);
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
        throw new Error("The same instruction bridge plan was already applied.");
      const identity = randomUUID().replaceAll("-", "");
      const receipt = await applyKnowledgeInstructionBridgePlan({
        plan,
        ...(approval === null
          ? {}
          : { approvedOperationId: approval[1]!, approvedHash: approval[2]! }),
        now: new Date(),
        supplementalSources,
        recordApplied: async (applied) => {
          const observedValidation = await lintRepositoryKnowledge(repositoryRoot, {
            allowTransactionPlanId: plan.planId,
            supplementalSources,
          });
          const validation = validateKnowledgeStage({
            stage: "the instruction bridge",
            before: baselineValidation,
            after: observedValidation,
            ownedErrorCodes: instructionBridgeKnowledgeLintCodes,
          });
          const validationArtifact = await storage.artifacts.put(canonicalJson(validation));
          storage.events.append({
            eventId: `evt_${identity}`,
            projectId: plan.projectId,
            runId: `run_${identity}`,
            sessionId: `ses_${identity}`,
            type: "knowledge.materialization.applied",
            occurredAt: applied.appliedAt,
            actor: { kind: "user" },
            schemaVersion: 1,
            policyVersion: plan.policyHash,
            payload: {
              operation: "instruction_bridge_update",
              planId: plan.planId,
              sourceSnapshotId: plan.sourceSnapshotId,
              policyHash: plan.policyHash,
              compilerId: "lervo.instruction-bridge",
              compilerVersion: `${plan.profile.profileId}@${plan.profile.profileVersion}`,
              approvalDigest: plan.status === "review_required" ? plan.approvalHash : null,
              coverage: plan.coverage,
              bundleIds: [],
              createdConceptIds: plan.createdConceptIds.slice(0, 256),
              updatedConceptIds: plan.updatedConceptIds.slice(0, 256),
              deprecatedConceptIds: [],
              conceptListTruncated:
                plan.createdConceptIds.length + plan.updatedConceptIds.length > 256,
              resultArtifactId: null,
              resultArtifactHash: null,
              createdCount: plan.operations.filter((item) => item.action === "create").length,
              updatedCount: plan.operations.filter((item) => item.action === "update").length,
              unchangedCount: plan.operations.filter((item) => item.action === "unchanged").length,
              beforeRegistryDigest: plan.registryDigest,
              afterRegistryDigest: plan.afterRegistryDigest,
              validationReportId: `klint_${validationArtifact.contentHash.slice("sha256:".length, "sha256:".length + 24)}`,
              validationReportHash: validationArtifact.contentHash,
              appliedAt: applied.appliedAt,
            },
          });
        },
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(receipt, null, 2)}\n`
          : `Applied the Claude instruction bridge and updated knowledge navigation.\nplan: ${receipt.planId}\nprofile: ${receipt.profileId}\ncanonical digest: ${receipt.canonicalPathDigest}\ntarget digest: ${receipt.targetPathDigest}\n`,
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
