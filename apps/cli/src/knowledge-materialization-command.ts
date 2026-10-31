import { materializationEventRecorded } from "./knowledge-materialization-history.js";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
  applySemanticKnowledgeMaterializationPlan,
  canonicalJson,
  createSemanticKnowledgeMaterializationPlan,
  lintRepositoryKnowledge,
  sha256,
  recoverKnowledgeMaterialization,
  RepositoryKnowledgeError,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliIo } from "./types.js";
import { knowledgeUsage } from "./knowledge-usage.js";

export async function runKnowledgeSemanticMaterialize(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        apply: { type: "string" },
        recover: { type: "boolean" },
        json: { type: "boolean" },
      },
    });
    if (parsed.values.recover) {
      if (parsed.positionals.length !== 0 || parsed.values.apply !== undefined)
        throw new Error("--recover cannot be combined with a review ID or --apply.");
      const root = resolve(io.cwd, parsed.values.root ?? ".");
      const storage = await openProjectStorage(root);
      try {
        const recovered = await recoverKnowledgeMaterialization({
          repositoryRoot: root,
          eventRecorded: (planId) => materializationEventRecorded(storage.events, planId),
        });
        io.stdout(
          parsed.values.json
            ? `${JSON.stringify(recovered, null, 2)}\n`
            : `Knowledge materialization transaction recovered: ${recovered.disposition === "rolled_back" ? "changes before the event were rolled back" : "recorded event outputs were retained and markers removed"}\nplan: ${recovered.planId}\n`,
        );
      } finally {
        await storage.close();
      }
      return 0;
    }
    if (parsed.positionals.length !== 1) throw new Error("materialize requires one review ID.");
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const supplementalSources = await collectLocalKnowledgeSources(root);
    const storage = await openProjectStorage(root);
    try {
      const plan = await createSemanticKnowledgeMaterializationPlan({
        repositoryRoot: root,
        reviewId: parsed.positionals[0] as string,
        artifacts: storage.artifacts,
        events: storage.events,
        supplementalSources,
      });
      if (parsed.values.apply === undefined) {
        const printable = {
          ...plan,
          operations: plan.operations.map(({ content: _content, ...operation }) => operation),
        };
        io.stdout(
          parsed.values.json
            ? `${JSON.stringify(printable, null, 2)}\n`
            : `Semantic materialization: ${plan.status}\nplan: ${plan.planId}\nreview: ${plan.reviewId}\nconcept created ${plan.createdConceptIds.length}, linked existing ${plan.updatedConceptIds.length}, claims ${plan.claimIds.length}, relations ${plan.relationIds.length}\nApproved user managed-block patches: ${plan.userPatchCount}\nNo files have been changed. Use --apply ${plan.planId} to apply.\n`,
        );
        return plan.status === "ready" ? 0 : 1;
      }
      if (parsed.values.apply !== plan.planId)
        throw new Error(
          "The requested plan ID does not match the current semantic materialization plan.",
        );
      if (
        storage.events
          .list()
          .some(
            (event) =>
              event.type === "knowledge.materialization.applied" &&
              event.payload.planId === plan.planId,
          )
      )
        throw new Error("The same semantic materialization plan was already applied.");
      const identity = randomUUID().replaceAll("-", "");
      const receipt = await applySemanticKnowledgeMaterializationPlan({
        plan,
        artifacts: storage.artifacts,
        events: storage.events,
        now: new Date(),
        supplementalSources,
        recordApplied: async (applied) => {
          const validation = await lintRepositoryKnowledge(root, {
            allowTransactionPlanId: plan.planId,
            supplementalSources,
          });
          if (validation.coverage !== "complete" || !validation.valid)
            throw new RepositoryKnowledgeError(
              "knowledge_apply_failed",
              `Deterministic lint failed after semantic materialization: ${[...new Set(validation.issues.map((issue) => issue.code))].sort().join(",")}`,
            );
          const validationHash = sha256(canonicalJson(validation));
          await storage.artifacts.put(canonicalJson(validation));
          storage.events.append({
            eventId: `evt_${identity}`,
            projectId: plan.projectId,
            runId: `run_${identity}`,
            sessionId: `ses_${identity}`,
            type: "knowledge.materialization.applied",
            occurredAt: applied.appliedAt,
            actor: { kind: "system" },
            schemaVersion: 1,
            policyVersion: plan.policyHash,
            payload: {
              operation: "semantic",
              planId: plan.planId,
              sourceSnapshotId: plan.sourceSnapshotId,
              policyHash: plan.policyHash,
              compilerId: plan.compiler.compilerId,
              compilerVersion: plan.compiler.compilerVersion,
              compilerBuildId: plan.compiler.compilerBuildId,
              approvalDigest: plan.reviewArtifactHash,
              coverage: plan.coverage,
              bundleIds: [],
              createdConceptIds: plan.createdConceptIds.slice(0, 256),
              updatedConceptIds: plan.updatedConceptIds.slice(0, 256),
              deprecatedConceptIds: [],
              conceptListTruncated:
                plan.createdConceptIds.length + plan.updatedConceptIds.length > 256,
              resultArtifactId: null,
              resultArtifactHash: null,
              createdCount: applied.created.length,
              updatedCount: applied.updated.length,
              unchangedCount: applied.unchanged.length,
              beforeRegistryDigest: plan.registryDigest,
              afterRegistryDigest: sha256(
                canonicalJson(
                  plan.operations.map((item) => ({
                    pathDigest: sha256(item.path),
                    hash: item.desiredHash,
                  })),
                ),
              ),
              validationReportId: `klint_${validationHash.slice(7, 31)}`,
              validationReportHash: validationHash,
              appliedAt: applied.appliedAt,
            },
          });
        },
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(receipt, null, 2)}\n`
          : `Materialized reviewed semantic knowledge. Created ${receipt.created.length}, updated ${receipt.updated.length}, unchanged ${receipt.unchanged.length}\nApplied user managed-block patches: ${plan.userPatchCount}\n`,
      );
      return 0;
    } finally {
      await storage.close();
    }
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}
