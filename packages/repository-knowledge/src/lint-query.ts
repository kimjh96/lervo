import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { loadDecisionTaxonomy, loadProjectManifest } from "@lervo/project";
import { parseManagedMarkdownBlocks } from "@lervo/documents";
import { parse } from "yaml";
import { listKnowledgeArtifactPaths, shardedKnowledgeArtifactPath } from "./artifact-paths.js";
import { sha256, stableId } from "./integrity.js";
import { analyzeRepositoryKnowledgeImpact } from "./impact.js";
import { assertNoKnowledgeMaterializationTransaction } from "./materialization-owner.js";
import {
  describeDocumentLayoutFinding,
  evaluateCurrentRepositoryDocumentLayout,
} from "./document-layout-enforcement.js";
import { inspectRepositoryDocumentRewriters } from "./document-rewriter-adapters.js";
import { lintDocumentDrift, type DocumentStalenessLintMode } from "./document-drift-lint.js";
import { loadRepositoryKnowledgePolicy } from "./policy.js";
import { repositoryKnowledgePublicationSnapshotId } from "./publication-snapshot.js";
import { lintPublicationRootResidents } from "./publication-root-lint.js";
import {
  generatedKnowledgePaths,
  readSafePublication,
  safePublicationPath,
} from "./repository-publication-files.js";
import { scanRepositoryKnowledge } from "./scanner.js";
import { loadStoredClaims, loadStoredConcepts, loadStoredRelations } from "./store-reader.js";
import { inspectGroupedDecisionPaths } from "./decision-layout.js";
import {
  inspectConfiguredDocumentNormalization,
  type DocumentNormalizationLifecycleInspection,
} from "./document-normalization.js";
import {
  legacyStructuralManifestPath,
  structuralBundleDirectory,
  structuralConceptDirectory,
  structuralManifestPath,
} from "./structural-projection.js";
import type {
  KnowledgeLintIssue,
  KnowledgeLintResult,
  RepositoryKnowledgePreparedScanOptions,
  RepositoryKnowledgeScanOptions,
} from "./types.js";

async function lintSemanticManifests(root: string, issues: KnowledgeLintIssue[]): Promise<void> {
  const directoryPath = ".lervo/generated/semantic-manifests";
  let paths: string[];
  try {
    paths = await listKnowledgeArtifactPaths({
      root,
      directory: directoryPath,
      extension: "json",
      maximumFiles: 20_000,
    });
  } catch {
    return;
  }
  for (const path of paths) {
    let outputs: Array<{ path: string; contentHash: string }>;
    try {
      const value = JSON.parse(await readFile(resolve(root, path), "utf8")) as {
        kind?: unknown;
        outputs?: unknown;
      };
      if (
        value.kind !== "semantic" ||
        !Array.isArray(value.outputs) ||
        !value.outputs.every(
          (item) => typeof item?.path === "string" && typeof item.contentHash === "string",
        )
      )
        throw new Error();
      outputs = value.outputs;
    } catch {
      issues.push({
        code: "invalid_semantic_generation_manifest",
        severity: "error",
        path,
        message: "The semantic generation manifest is invalid.",
      });
      continue;
    }
    for (const output of outputs) {
      const target = safePublicationPath(root, output.path);
      try {
        if (target === null) throw new Error();
        const stats = await lstat(target);
        if (
          !stats.isFile() ||
          stats.isSymbolicLink() ||
          sha256(await readFile(target)) !== output.contentHash
        )
          throw new Error();
      } catch {
        issues.push({
          code: "semantic_generated_output_modified",
          severity: "error",
          path: output.path,
          message: "The output differs from the Lervo-owned bytes recorded by semantic generation.",
        });
      }
    }
  }
}

async function lintInstructionBridgeRecords(
  root: string,
  projectId: string,
  issues: KnowledgeLintIssue[],
): Promise<void> {
  const directoryPath = ".lervo/knowledge/instruction-bridges";
  let paths: string[];
  try {
    paths = await listKnowledgeArtifactPaths({
      root,
      directory: directoryPath,
      extension: "yaml",
      maximumFiles: 256,
    });
  } catch {
    issues.push({
      code: "invalid_instruction_bridge_record",
      severity: "error",
      path: directoryPath,
      message: "The instruction bridge registry cannot be read safely.",
    });
    return;
  }
  const ids = new Set<string>();
  for (const path of paths) {
    const name = path.split("/").at(-1)!;
    const recordBytes = await readSafePublication(root, path, 64 * 1024);
    if (recordBytes === null) {
      issues.push({
        code: "invalid_instruction_bridge_record",
        severity: "error",
        path,
        message: "The instruction bridge record cannot be read safely.",
      });
      continue;
    }
    let value: {
      schemaVersion: number;
      bridgeId: string;
      profile: { id: string; version: number; provider: string; discoveryContract: string };
      canonical: { path: string; contentHash: string };
      target: { path: string; contentHash: string; blockId: string; managedContentHash: string };
    };
    try {
      value = parse(new TextDecoder("utf-8", { fatal: true }).decode(recordBytes)) as typeof value;
      const expectedId = stableId("kbridge", {
        projectId,
        provider: "claude",
        canonicalPath: "AGENTS.md",
        targetPath: "CLAUDE.md",
      });
      if (
        value?.schemaVersion !== 1 ||
        value.bridgeId !== expectedId ||
        name !== `${expectedId}.yaml` ||
        ids.has(value.bridgeId) ||
        (path.split("/").length > 4 &&
          path !== shardedKnowledgeArtifactPath(directoryPath, value.bridgeId, "yaml")) ||
        value.profile?.id !== "claude_agents_import_v1" ||
        value.profile.version !== 1 ||
        value.profile.provider !== "claude" ||
        value.profile.discoveryContract !== "claude-code-memory-import" ||
        value.canonical?.path !== "AGENTS.md" ||
        value.target?.path !== "CLAUDE.md" ||
        value.target.blockId !== "provider_entry" ||
        !/^sha256:[a-f0-9]{64}$/.test(value.canonical.contentHash) ||
        !/^sha256:[a-f0-9]{64}$/.test(value.target.contentHash) ||
        !/^sha256:[a-f0-9]{64}$/.test(value.target.managedContentHash)
      )
        throw new Error("invalid record");
      ids.add(value.bridgeId);
    } catch {
      issues.push({
        code: "invalid_instruction_bridge_record",
        severity: "error",
        path,
        message: "The instruction bridge record does not satisfy its registered profile contract.",
      });
      continue;
    }
    const canonicalBytes = await readSafePublication(root, value.canonical.path, 1024 * 1024);
    const targetBytes = await readSafePublication(root, value.target.path, 1024 * 1024);
    if (
      canonicalBytes === null ||
      targetBytes === null ||
      sha256(canonicalBytes) !== value.canonical.contentHash ||
      sha256(targetBytes) !== value.target.contentHash
    ) {
      issues.push({
        code: "instruction_bridge_binding_stale",
        severity: "error",
        path,
        message:
          "The instruction bridge canonical or target byte binding differs from the current repository.",
      });
      continue;
    }
    const parsedTarget = parseManagedMarkdownBlocks(targetBytes);
    const block = parsedTarget.blocks.find((item) => item.blockId === value.target.blockId);
    if (
      parsedTarget.status !== "valid" ||
      block === undefined ||
      sha256(targetBytes.slice(block.contentRange.start, block.contentRange.end)) !==
        value.target.managedContentHash ||
      new TextDecoder().decode(
        targetBytes.slice(block.contentRange.start, block.contentRange.end),
      ) !== "@AGENTS.md\n"
    ) {
      issues.push({
        code: "instruction_bridge_target_invalid",
        severity: "error",
        path: value.target.path,
        message: "The provider entry managed block differs from the profile's canonical import.",
      });
    }
  }
}

async function lintRepositoryLayout(root: string, issues: KnowledgeLintIssue[]): Promise<void> {
  const layout = await evaluateCurrentRepositoryDocumentLayout({
    repositoryRoot: root,
    operations: [],
  });
  for (const blocker of layout.blockers) {
    issues.push({
      code: blocker.code,
      severity: "error",
      path: "directory" in blocker ? blocker.directory : "scope" in blocker ? blocker.scope : ".",
      message: `The current repository document layout violates ${describeDocumentLayoutFinding(blocker)}.`,
    });
  }
  // ADR-0583: overflow that existed before any Lervo write is user-owned debt, not a failure.
  for (const advisory of layout.advisories) {
    issues.push({
      code: advisory.code,
      severity: "warning",
      path: "directory" in advisory ? advisory.directory : ".",
      message: `The repository document layout exceeds ${describeDocumentLayoutFinding(advisory)}. This is an advisory: a write that leaves this directory alone is not blocked.`,
    });
  }
  const taxonomy = await loadDecisionTaxonomy(root);
  const decisionPaths: string[] = [];
  for (const directory of [taxonomy.decisionRoot, ...taxonomy.legacyRoots]) {
    try {
      const entries = await readdir(resolve(root, directory), {
        withFileTypes: true,
        recursive: true,
      });
      for (const entry of entries) {
        if (!entry.isFile() || !/^\d{4}-.+\.md$/u.test(entry.name)) continue;
        decisionPaths.push(
          relative(root, resolve(entry.parentPath, entry.name)).split(sep).join("/"),
        );
      }
    } catch {
      /* a repository need not have decisions */
    }
  }
  for (const path of decisionPaths) {
    const roots = [taxonomy.decisionRoot, ...taxonomy.legacyRoots];
    if (
      roots.some(
        (directory) =>
          path.startsWith(`${directory}/`) && !path.slice(directory.length + 1).includes("/"),
      )
    ) {
      // ADR-0476: an ungrouped decision waits for a semantic route; it is pending, not invalid.
      issues.push({
        code: "ungrouped_decision_document",
        severity: "warning",
        path,
        message:
          "The decision document awaits a semantic route. Add lervo.decision.route metadata naming a configured route, or let the background knowledge resident classify it.",
      });
    }
  }
  for (const blocker of inspectGroupedDecisionPaths(decisionPaths, taxonomy)) {
    const message =
      blocker.code === "decision_leaf_overflow"
        ? `The decision leaf has ${blocker.observedCount} documents and exceeds its configured maximum of ${blocker.configuredMaximum}. Add a semantic route and move the affected decisions.`
        : blocker.code === "legacy_decision_layout"
          ? "The decision remains under a legacy decision root. Run lervo migrate knowledge."
          : "The decision directory is not an allowed route in the tracked repository taxonomy.";
    issues.push({ code: blocker.code, severity: "error", path: blocker.path, message });
  }

  const registries = [
    [structuralBundleDirectory, "yaml"],
    [structuralConceptDirectory, "yaml"],
    [".lervo/knowledge/bundles", "yaml"],
    [".lervo/knowledge/concepts", "yaml"],
    [".lervo/knowledge/claims", "yaml"],
    [".lervo/knowledge/relations", "yaml"],
    [".lervo/knowledge/source-lineage", "yaml"],
    [".lervo/knowledge/instruction-bridges", "yaml"],
    [".lervo/knowledge/document-normalizations", "yaml"],
    [".lervo/generated/semantic-manifests", "json"],
    [".lervo/state/knowledge/candidates", "json"],
  ] as const;
  for (const [directory, extension] of registries) {
    let paths: string[];
    try {
      paths = await listKnowledgeArtifactPaths({
        root,
        directory,
        extension,
        maximumFiles: 20_000,
      });
    } catch {
      continue;
    }
    for (const path of paths) {
      if (!path.slice(directory.length + 1).includes("/"))
        issues.push({
          code: "legacy_flat_artifact",
          severity: "error",
          path,
          message:
            "The ID-addressed artifact requires deterministic two-hex sharding. Run lervo migrate knowledge.",
        });
    }
  }
}

export async function lintRepositoryKnowledge(
  repositoryRoot: string,
  options: {
    allowTransactionPlanId?: string;
    preparedNormalization?: DocumentNormalizationLifecycleInspection;
    /** Background passes record the staleness projection; foreground lint only reads it. */
    documentStaleness?: DocumentStalenessLintMode;
  } & RepositoryKnowledgeScanOptions &
    RepositoryKnowledgePreparedScanOptions = {},
): Promise<KnowledgeLintResult> {
  const root = resolve(repositoryRoot);
  await assertNoKnowledgeMaterializationTransaction({
    repositoryRoot: root,
    ...(options?.allowTransactionPlanId === undefined
      ? {}
      : { allowedPlanId: options.allowTransactionPlanId }),
  });
  const issues: KnowledgeLintIssue[] = [];
  await lintRepositoryLayout(root, issues);
  const rewrite = await inspectRepositoryDocumentRewriters({
    repositoryRoot: root,
    ...(options.allowTransactionPlanId === undefined
      ? {}
      : { allowTransactionPlanId: options.allowTransactionPlanId }),
  });
  for (const blocker of rewrite.blockers) {
    issues.push({
      code: blocker.code,
      severity: "error",
      path: "path" in blocker ? blocker.path : ".lervo/knowledge/document-layout.yaml",
      message: `The current repository document rewrite contract violates ${blocker.code}.`,
    });
  }
  await lintSemanticManifests(root, issues);
  const manifests: Array<{
    sourceSnapshotId: string;
    outputs: Array<{ path: string; contentHash: string }>;
  }> = [];
  let manifestFound = false;
  for (const path of [structuralManifestPath, legacyStructuralManifestPath]) {
    try {
      const stats = await lstat(resolve(root, path));
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error();
      manifestFound = true;
      try {
        const value = JSON.parse(await readFile(resolve(root, path), "utf8")) as Partial<{
          sourceSnapshotId: string;
          outputs: Array<{ path: string; contentHash: string }>;
        }>;
        if (
          typeof value.sourceSnapshotId !== "string" ||
          !Array.isArray(value.outputs) ||
          !value.outputs.every(
            (item) => typeof item?.path === "string" && typeof item.contentHash === "string",
          )
        )
          throw new Error();
        manifests.push(
          value as {
            sourceSnapshotId: string;
            outputs: Array<{ path: string; contentHash: string }>;
          },
        );
      } catch {
        issues.push({
          code: "invalid_generation_manifest",
          severity: "error",
          path,
          message: "The generation manifest JSON cannot be read.",
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && manifestFound === false)
        issues.push({
          code: "invalid_generation_manifest",
          severity: "error",
          path,
          message: "The generation manifest is not a safe regular file.",
        });
    }
  }
  if (!manifestFound) {
    issues.push({
      code: "missing_generation_manifest",
      severity: "warning",
      path: structuralManifestPath,
      message:
        "No applied structural knowledge generation exists. Git ignores generated knowledge, so a fresh clone starts here: run `lervo migrate knowledge`.",
    });
  }
  const project = await loadProjectManifest(root);
  await lintInstructionBridgeRecords(root, project.projectId, issues);
  const normalization =
    options.preparedNormalization ??
    (await inspectConfiguredDocumentNormalization({
      repositoryRoot: root,
      ...(options.supplementalSources === undefined
        ? {}
        : { supplementalSources: options.supplementalSources }),
      ...(options.preparedScan === undefined ? {} : { preparedScan: options.preparedScan }),
      ...(options.allowTransactionPlanId === undefined
        ? {}
        : { allowTransactionPlanId: options.allowTransactionPlanId }),
    }));
  for (const record of normalization.records) {
    if (record.status === "invalid")
      issues.push({
        code: "invalid_document_normalization_record",
        severity: "error",
        path: record.path,
        message: "The document normalization lifecycle record is invalid.",
      });
    const historicalPublicReadme =
      record.outputPaths.length === 1 && record.outputPaths[0] === "README.md";
    if (record.status === "stale" && !historicalPublicReadme)
      issues.push({
        code: "document_normalization_stale",
        severity: "warning",
        path: record.path,
        message:
          "A normalized document family changed after its reviewed rewrite. Create a new content-bound normalization candidate.",
      });
  }
  const policy = await loadRepositoryKnowledgePolicy(root);
  const generated = await generatedKnowledgePaths(root);
  await lintPublicationRootResidents({
    root,
    publicationRoot: policy.publicationRoot,
    generatedPaths: generated,
    issues,
  });
  const scan =
    options.preparedScan ??
    (await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: project.projectId,
      policy,
      generatedPaths: generated,
      ...(options.supplementalSources === undefined
        ? {}
        : { supplementalSources: options.supplementalSources }),
    }));
  if (scan.projectId !== project.projectId || scan.policyId !== policy.policyId) {
    throw new Error("The prepared knowledge scan does not match the current project policy.");
  }
  if (scan.coverage === "partial")
    issues.push({
      code: "knowledge_scan_partial",
      severity: "warning",
      path: ".lervo/knowledge/policy.yaml",
      message: `Repository scan coverage is partial: ${scan.skippedForBudget.count} sources and ${scan.skippedForBudget.bytes} bytes skipped for budget (${scan.skippedForBudget.classes.join(", ")}).`,
    });
  const currentManifest = manifests.find(
    (item) => item.sourceSnapshotId === repositoryKnowledgePublicationSnapshotId(scan),
  );
  if (currentManifest === undefined) {
    issues.push({
      code: "materialization_stale",
      severity: "warning",
      path: ".lervo/knowledge",
      message:
        "No generation materializes the current source snapshot. Inspect the knowledge refresh plan.",
    });
  } else {
    for (const output of currentManifest.outputs) {
      const target = safePublicationPath(root, output.path);
      if (target === null) {
        issues.push({
          code: "generated_output_outside_repository",
          severity: "error",
          path: output.path,
          message: "The generation output escapes the repository.",
        });
        continue;
      }
      try {
        const stats = await lstat(target);
        const bytes = await readFile(target);
        if (!stats.isFile() || stats.isSymbolicLink() || sha256(bytes) !== output.contentHash)
          throw new Error();
        const publicationPrefix = `${policy.publicationRoot.replace(/\/$/u, "")}/`;
        if (output.path.startsWith(publicationPrefix) && output.path.endsWith(".md")) {
          if (bytes.byteLength > policy.publication.maxNavigationBytes) {
            issues.push({
              code: "publication_size_exceeded",
              severity: "error",
              path: output.path,
              message: "Generated navigation exceeds the configured UTF-8 byte bound.",
            });
          }
          const prose = bytes
            .toString("utf8")
            .replace(/```[\s\S]*?```/gu, "")
            .replace(/`[^`]*`/gu, "")
            .replace(/\]\([^)]*\)/gu, "]")
            .replace(/<!--[\s\S]*?-->/gu, "");
          if (policy.publication.language === "en" && /[\u3131-\u318E\uAC00-\uD7A3]/u.test(prose)) {
            issues.push({
              code: "publication_language_mismatch",
              severity: "error",
              path: output.path,
              message: "Generated publication contains Hangul while publication.language is en.",
            });
          }
        }
      } catch {
        issues.push({
          code: "generated_output_modified",
          severity: "error",
          path: output.path,
          message:
            "The output differs from the Lervo-generated bytes recorded by the current source generation.",
        });
      }
    }
  }
  const drift = await lintDocumentDrift({
    root,
    scan,
    policy,
    generatedPaths: generated,
    taxonomy: await loadDecisionTaxonomy(root).catch(() => null),
    normalizationRecords: normalization.records,
    // Transaction-bound stage checks compare errors only; staleness reads committed history.
    staleness:
      options.allowTransactionPlanId !== undefined
        ? "skip"
        : (options.documentStaleness ?? "evaluate"),
  });
  issues.push(...drift.issues);
  const currentUnitVersions = new Set(scan.units.map((unit) => unit.unitVersionId));
  const concepts = await loadStoredConcepts(root);
  const claims = await loadStoredClaims(root);
  const relations = await loadStoredRelations(root);
  const impact =
    claims.every((item) => item.value !== null) && relations.every((item) => item.value !== null)
      ? await analyzeRepositoryKnowledgeImpact({ repositoryRoot: root, scan })
      : null;
  const impactBySubject = new Map(
    impact?.items.map((item) => [`${item.subjectKind}:${item.subjectId}`, item]),
  );
  const claimedPaths = new Map<string, string>();
  for (const stored of concepts) {
    if (stored.value === null) {
      issues.push({
        code: "invalid_concept",
        severity: "error",
        path: stored.file,
        message: stored.error ?? "The concept sidecar is invalid.",
      });
      continue;
    }
    const concept = stored.value;
    if (concept.publicationStatus === "deprecated") continue;
    const existing = claimedPaths.get(concept.path);
    if (existing !== undefined) {
      issues.push({
        code: "publication_path_conflict",
        severity: "error",
        path: stored.file,
        message: `${concept.path} conflicts with ${existing}.`,
      });
    } else claimedPaths.set(concept.path, concept.conceptId);
    const publication = safePublicationPath(root, concept.path);
    if (publication === null) {
      issues.push({
        code: "publication_outside_repository",
        severity: "error",
        path: stored.file,
        message: `${concept.path} escapes the repository.`,
      });
      continue;
    }
    try {
      const stats = await lstat(publication);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error();
    } catch {
      issues.push({
        code: "publication_missing",
        severity: "error",
        path: concept.path,
        message: "The concept publication does not exist as a regular file.",
      });
    }
    const stale = concept.sourceUnitVersionIds.filter((id) => !currentUnitVersions.has(id));
    if (stale.length > 0) {
      issues.push({
        code: "source_unit_stale",
        severity: "warning",
        path: stored.file,
        message: `${stale.length} source unit versions differ from the current snapshot.`,
      });
    }
  }
  const conceptIds = new Set(
    concepts.flatMap((item) => (item.value === null ? [] : [item.value.conceptId])),
  );
  for (const stored of claims) {
    if (stored.value === null) {
      issues.push({
        code: "invalid_claim",
        severity: "error",
        path: stored.file,
        message: stored.error ?? "The claim sidecar is invalid.",
      });
      continue;
    }
    if (!conceptIds.has(stored.value.conceptId))
      issues.push({
        code: "claim_concept_missing",
        severity: "error",
        path: stored.file,
        message: "The claim references a concept that does not exist.",
      });
    const claimImpact = impactBySubject.get(`claim:${stored.value.claimId}`);
    if (claimImpact?.freshness === "stale")
      issues.push({
        code: "claim_evidence_stale",
        severity: "warning",
        path: stored.file,
        message: `Claim evidence depends on changed or deleted source units: ${claimImpact.reasons.join(", ")}`,
      });
    if (claimImpact?.freshness === "unknown")
      issues.push({
        code: "claim_evidence_unknown",
        severity: "warning",
        path: stored.file,
        message: "Stable source-unit lineage cannot be confirmed for the claim evidence.",
      });
  }
  for (const stored of relations) {
    if (stored.value === null) {
      issues.push({
        code: "invalid_relation",
        severity: "error",
        path: stored.file,
        message: stored.error ?? "The relation sidecar is invalid.",
      });
      continue;
    }
    if (!conceptIds.has(stored.value.from.id) || !conceptIds.has(stored.value.to.id))
      issues.push({
        code: "relation_endpoint_missing",
        severity: "error",
        path: stored.file,
        message: "A relation concept endpoint is missing.",
      });
    const relationImpact = impactBySubject.get(`relation:${stored.value.relationId}`);
    if (relationImpact?.freshness === "stale")
      issues.push({
        code: "relation_evidence_stale",
        severity: "warning",
        path: stored.file,
        message: `Relation evidence depends on changed or deleted source units: ${relationImpact.reasons.join(", ")}`,
      });
    if (relationImpact?.freshness === "unknown")
      issues.push({
        code: "relation_evidence_unknown",
        severity: "warning",
        path: stored.file,
        message: "Stable source-unit lineage cannot be confirmed for the relation evidence.",
      });
  }
  return {
    schemaVersion: 1,
    repositoryRoot: root,
    coverage: scan.coverage,
    skippedForBudget: scan.skippedForBudget,
    valid: issues.every((issue) => issue.severity !== "error"),
    checkedConcepts: concepts.filter((item) => item.value !== null).length,
    issues,
    ...(drift.documentStaleness === undefined
      ? {}
      : { documentStaleness: drift.documentStaleness }),
  };
}
