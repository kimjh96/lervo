import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
  applyKnowledgeDocumentMergePlan,
  applyKnowledgeDocumentMovePlan,
  applyKnowledgeDocumentSplitPlan,
  canonicalJson,
  createKnowledgeDocumentDeletionPlan,
  createKnowledgeDocumentMergePlan,
  createKnowledgeDocumentMovePlan,
  createKnowledgeDocumentSplitPlan,
  lintRepositoryKnowledge,
  serializableKnowledgeDocumentDeletionPlan,
  serializableKnowledgeDocumentMergePlan,
  serializableKnowledgeDocumentMovePlan,
  serializableKnowledgeDocumentSplitPlan,
  applyKnowledgeDocumentDeletionPlan,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliIo } from "./types.js";
import { knowledgeUsage } from "./knowledge-usage.js";

export async function runKnowledgeStructure(args: string[], io: CliIo): Promise<number> {
  try {
    const structureOperation = args[0];
    if (
      structureOperation !== "delete" &&
      structureOperation !== "move" &&
      structureOperation !== "merge" &&
      structureOperation !== "split"
    )
      throw new Error("The structure command supports delete, move, merge, and split.");
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        apply: { type: "string" },
        "approve-item": { type: "string" },
        "at-heading": { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (structureOperation === "move" && parsed.positionals.length !== 2)
      throw new Error(
        "structure move requires source and destination repository-relative Markdown paths.",
      );
    if (structureOperation === "merge" && parsed.positionals.length !== 2)
      throw new Error(
        "structure merge requires source and destination repository-relative Markdown paths.",
      );
    if (
      structureOperation === "split" &&
      (parsed.positionals.length !== 2 || parsed.values["at-heading"] === undefined)
    )
      throw new Error(
        "structure split requires source, destination, and --at-heading <heading-locator>.",
      );
    if (structureOperation !== "split" && parsed.values["at-heading"] !== undefined)
      throw new Error("--at-heading may be used only with structure split.");
    if (structureOperation === "delete" && parsed.positionals.length !== 1)
      throw new Error("structure delete requires one repository-relative Markdown path.");
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
    if (structureOperation === "move") {
      const plan = await createKnowledgeDocumentMovePlan({
        repositoryRoot,
        fromPath: parsed.positionals[0]!,
        toPath: parsed.positionals[1]!,
        supplementalSources,
      });
      if (parsed.values.apply === undefined) {
        if (parsed.values["approve-item"] !== undefined)
          throw new Error("--approve-item must be used with --apply.");
        io.stdout(
          parsed.values.json
            ? `${JSON.stringify(serializableKnowledgeDocumentMovePlan(plan), null, 2)}\n`
            : `User document move review plan created.\nplan: ${plan.planId}\noperation: ${plan.operationId}\nsource: ${plan.document.fromPath} · ${plan.document.contentHash} · ${plan.document.byteCount} bytes\ndestination: ${plan.document.toPath}\npreserved concepts: ${plan.preservedConceptIds.length}\napproval: ${plan.operationId}=${plan.approvalHash}\nDocuments, sidecars, and navigation have not been changed.\n`,
        );
        return 0;
      }
      if (parsed.values.apply !== plan.planId)
        throw new Error("The requested plan ID does not match the current document move plan.");
      const approval = /^(kdocop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(
        parsed.values["approve-item"] ?? "",
      );
      if (approval === null)
        throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
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
          throw new Error("The same document move plan was already applied.");
        const identity = randomUUID().replaceAll("-", "");
        const receipt = await applyKnowledgeDocumentMovePlan({
          plan,
          approvedOperationId: approval[1]!,
          approvedHash: approval[2]!,
          now: new Date(),
          supplementalSources,
          recordApplied: async (applied) => {
            const validation = await lintRepositoryKnowledge(repositoryRoot, {
              allowTransactionPlanId: plan.planId,
              supplementalSources,
            });
            if (!validation.valid)
              throw new Error("Deterministic lint failed after the document move.");
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
                operation: "document_structure_move",
                planId: plan.planId,
                sourceSnapshotId: plan.sourceSnapshotId,
                policyHash: plan.policyHash,
                compilerId: "lervo.document-structure",
                compilerVersion: "1",
                approvalDigest: plan.approvalHash,
                coverage: plan.coverage,
                bundleIds: [],
                createdConceptIds: plan.createdConceptIds.slice(0, 256),
                updatedConceptIds: plan.updatedConceptIds.slice(0, 256),
                deprecatedConceptIds: plan.deprecatedConceptIds.slice(0, 256),
                conceptListTruncated:
                  plan.createdConceptIds.length +
                    plan.updatedConceptIds.length +
                    plan.deprecatedConceptIds.length >
                  256,
                resultArtifactId: null,
                resultArtifactHash: null,
                createdCount: plan.operations.filter((item) => item.action === "create").length,
                updatedCount: plan.operations.filter((item) => item.action === "update").length + 1,
                unchangedCount: plan.operations.filter((item) => item.action === "unchanged")
                  .length,
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
            : `Moved the user document while preserving concept identity and source-unit lineage.\nplan: ${receipt.planId}\npreserved concepts: ${receipt.preservedConceptIds.length}\nsource digest: ${receipt.fromPathDigest}\ndestination digest: ${receipt.toPathDigest}\n`,
        );
      } finally {
        await storage.close();
      }
      return 0;
    }
    if (structureOperation === "merge") {
      const plan = await createKnowledgeDocumentMergePlan({
        repositoryRoot,
        sourcePath: parsed.positionals[0]!,
        destinationPath: parsed.positionals[1]!,
        supplementalSources,
      });
      if (parsed.values.apply === undefined) {
        if (parsed.values["approve-item"] !== undefined)
          throw new Error("--approve-item must be used with --apply.");
        io.stdout(
          parsed.values.json
            ? `${JSON.stringify(serializableKnowledgeDocumentMergePlan(plan), null, 2)}\n`
            : `User document merge review plan created.\nplan: ${plan.planId}\noperation: ${plan.operationId}\nsource: ${plan.source.path} · ${plan.source.contentHash} · ${plan.source.byteCount} bytes\ndestination: ${plan.destination.path} · ${plan.destination.beforeHash} → ${plan.destination.afterHash}\ncomposition: destination_then_source\ndeprecated concepts: ${plan.deprecatedConceptIds.length}\napproval: ${plan.operationId}=${plan.approvalHash}\nDocuments, lineage, sidecars, and navigation have not been changed.\n`,
        );
        return 0;
      }
      if (parsed.values.apply !== plan.planId)
        throw new Error("The requested plan ID does not match the current document merge plan.");
      const approval = /^(kdocop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(
        parsed.values["approve-item"] ?? "",
      );
      if (approval === null)
        throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
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
          throw new Error("The same document merge plan was already applied.");
        const identity = randomUUID().replaceAll("-", "");
        const receipt = await applyKnowledgeDocumentMergePlan({
          plan,
          approvedOperationId: approval[1]!,
          approvedHash: approval[2]!,
          now: new Date(),
          supplementalSources,
          recordApplied: async (applied) => {
            const validation = await lintRepositoryKnowledge(repositoryRoot, {
              allowTransactionPlanId: plan.planId,
              supplementalSources,
            });
            if (!validation.valid)
              throw new Error("Deterministic lint failed after the document merge.");
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
                operation: "document_structure_merge",
                planId: plan.planId,
                sourceSnapshotId: plan.sourceSnapshotId,
                policyHash: plan.policyHash,
                compilerId: "lervo.document-structure",
                compilerVersion: "1",
                approvalDigest: plan.approvalHash,
                coverage: plan.coverage,
                bundleIds: [],
                createdConceptIds: plan.createdConceptIds.slice(0, 256),
                updatedConceptIds: plan.updatedConceptIds.slice(0, 256),
                deprecatedConceptIds: plan.deprecatedConceptIds.slice(0, 256),
                conceptListTruncated:
                  plan.createdConceptIds.length +
                    plan.updatedConceptIds.length +
                    plan.deprecatedConceptIds.length >
                  256,
                resultArtifactId: null,
                resultArtifactHash: null,
                createdCount: plan.operations.filter((item) => item.action === "create").length,
                updatedCount: plan.operations.filter((item) => item.action === "update").length,
                unchangedCount: plan.operations.filter((item) => item.action === "unchanged")
                  .length,
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
            : `Merged the source document into the destination byte-for-byte and updated knowledge navigation.\nplan: ${receipt.planId}\nmerged bytes: ${receipt.mergedByteCount}\nsource digest: ${receipt.sourcePathDigest}\ndestination digest: ${receipt.destinationPathDigest}\n`,
        );
      } finally {
        await storage.close();
      }
      return 0;
    }
    if (structureOperation === "split") {
      const plan = await createKnowledgeDocumentSplitPlan({
        repositoryRoot,
        sourcePath: parsed.positionals[0]!,
        destinationPath: parsed.positionals[1]!,
        headingLocator: parsed.values["at-heading"]!,
        supplementalSources,
      });
      if (parsed.values.apply === undefined) {
        if (parsed.values["approve-item"] !== undefined)
          throw new Error("--approve-item must be used with --apply.");
        io.stdout(
          parsed.values.json
            ? `${JSON.stringify(serializableKnowledgeDocumentSplitPlan(plan), null, 2)}\n`
            : `User document split review plan created.\nplan: ${plan.planId}\noperation: ${plan.operationId}\nsource: ${plan.source.path} · ${plan.source.beforeHash} → ${plan.source.afterHash}\ndestination: ${plan.destination.path} · ${plan.destination.contentHash}\nheading: ${plan.heading.locator} · byte ${plan.heading.startByte}..${plan.heading.endByte}\napproval: ${plan.operationId}=${plan.approvalHash}\nDocuments, lineage, sidecars, and navigation have not been changed.\n`,
        );
        return 0;
      }
      if (parsed.values.apply !== plan.planId)
        throw new Error("The requested plan ID does not match the current document split plan.");
      const approval = /^(kdocop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(
        parsed.values["approve-item"] ?? "",
      );
      if (approval === null)
        throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
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
          throw new Error("The same document split plan was already applied.");
        const identity = randomUUID().replaceAll("-", "");
        const receipt = await applyKnowledgeDocumentSplitPlan({
          plan,
          approvedOperationId: approval[1]!,
          approvedHash: approval[2]!,
          now: new Date(),
          supplementalSources,
          recordApplied: async (applied) => {
            const validation = await lintRepositoryKnowledge(repositoryRoot, {
              allowTransactionPlanId: plan.planId,
              supplementalSources,
            });
            if (!validation.valid)
              throw new Error("Deterministic lint failed after the document split.");
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
                operation: "document_structure_split",
                planId: plan.planId,
                sourceSnapshotId: plan.sourceSnapshotId,
                policyHash: plan.policyHash,
                compilerId: "lervo.document-structure",
                compilerVersion: "1",
                approvalDigest: plan.approvalHash,
                coverage: plan.coverage,
                bundleIds: [],
                createdConceptIds: plan.createdConceptIds.slice(0, 256),
                updatedConceptIds: plan.updatedConceptIds.slice(0, 256),
                deprecatedConceptIds: plan.deprecatedConceptIds.slice(0, 256),
                conceptListTruncated:
                  plan.createdConceptIds.length +
                    plan.updatedConceptIds.length +
                    plan.deprecatedConceptIds.length >
                  256,
                resultArtifactId: null,
                resultArtifactHash: null,
                createdCount: plan.operations.filter((item) => item.action === "create").length,
                updatedCount: plan.operations.filter((item) => item.action === "update").length,
                unchangedCount: plan.operations.filter((item) => item.action === "unchanged")
                  .length,
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
            : `Split the heading subtree into a new user document and updated knowledge navigation.\nplan: ${receipt.planId}\nextracted bytes: ${receipt.extractedByteCount}\nsource digest: ${receipt.sourcePathDigest}\ndestination digest: ${receipt.destinationPathDigest}\n`,
        );
      } finally {
        await storage.close();
      }
      return 0;
    }
    const plan = await createKnowledgeDocumentDeletionPlan({
      repositoryRoot,
      documentPath: parsed.positionals[0]!,
      supplementalSources,
    });
    if (parsed.values.apply === undefined) {
      if (parsed.values["approve-item"] !== undefined)
        throw new Error("--approve-item must be used with --apply.");
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(serializableKnowledgeDocumentDeletionPlan(plan), null, 2)}\n`
          : `User document deletion review plan created.\nplan: ${plan.planId}\noperation: ${plan.operationId}\ntarget: ${plan.document.path} · ${plan.document.contentHash} · ${plan.document.byteCount} bytes\ndeprecated concepts: ${plan.deprecatedConceptIds.length}\napproval: ${plan.operationId}=${plan.approvalHash}\nDocuments and sidecars have not been changed.\n`,
      );
      return 0;
    }
    if (parsed.values.apply !== plan.planId)
      throw new Error("The requested plan ID does not match the current document structure plan.");
    const approval = /^(kdocop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/.exec(
      parsed.values["approve-item"] ?? "",
    );
    if (approval === null)
      throw new Error("--approve-item must use <operation-id>=<sha256-approval-hash>.");
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
        throw new Error("The same document structure plan was already applied.");
      const identity = randomUUID().replaceAll("-", "");
      const receipt = await applyKnowledgeDocumentDeletionPlan({
        plan,
        approvedOperationId: approval[1]!,
        approvedHash: approval[2]!,
        now: new Date(),
        supplementalSources,
        recordApplied: async (applied) => {
          const validation = await lintRepositoryKnowledge(repositoryRoot, {
            allowTransactionPlanId: plan.planId,
            supplementalSources,
          });
          if (!validation.valid)
            throw new Error("Deterministic lint failed after document deletion.");
          const validationBytes = canonicalJson(validation);
          const validationArtifact = await storage.artifacts.put(validationBytes);
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
              operation: "document_structure_delete",
              planId: plan.planId,
              sourceSnapshotId: plan.sourceSnapshotId,
              policyHash: plan.policyHash,
              compilerId: "lervo.document-structure",
              compilerVersion: "1",
              approvalDigest: plan.approvalHash,
              coverage: plan.coverage,
              bundleIds: [],
              createdConceptIds: [],
              updatedConceptIds: [],
              deprecatedConceptIds: plan.deprecatedConceptIds,
              conceptListTruncated: false,
              resultArtifactId: null,
              resultArtifactHash: null,
              createdCount: 0,
              updatedCount: applied.updatedSidecars.length,
              unchangedCount: 0,
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
          : `Deleted the user document and deprecated linked concepts.\nplan: ${receipt.planId}\ndeprecated concepts: ${receipt.deprecatedConceptIds.length}\npath digest: ${receipt.deletedPathDigest}\n`,
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
