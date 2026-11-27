import { resolve } from "node:path";

import { stringify } from "yaml";

import { listKnowledgeArtifactPaths } from "./artifact-paths.js";
import { repositoryInstructionPaths } from "./document-layout.js";
import { createKnowledgeInstructionBridgePlan } from "./instruction-bridge.js";
import { repositoryInstructionRouteBlock } from "./instruction-routes.js";
import { sha256 } from "./integrity.js";
import type { RepositoryLayoutCandidate } from "./repository-layout-candidates.js";
import { repositoryPathExists } from "./repository-layout-destinations.js";
import type { RepositoryLayoutReferenceChange } from "./repository-layout-references.js";
import {
  RepositoryKnowledgeError,
  type KnowledgeFileOperation,
  type RepositoryKnowledgeScan,
  type RepositoryKnowledgeScanOptions,
  type RepositorySource,
} from "./types.js";

function routedInstructionSurfaces(
  scan: RepositoryKnowledgeScan,
  executableCandidates: RepositoryLayoutCandidate[],
): {
  instructions: Array<{ toPath: string; instructionPaths?: string[] }>;
  skills: Array<{ toPath: string }>;
} {
  const instructionCandidates = executableCandidates.filter(
    (item) => item.classification === "instruction",
  );
  const existingInstructions = scan.sources.flatMap((source) =>
    source.status === "included" &&
    source.content !== undefined &&
    source.contentHash !== null &&
    source.path.startsWith("docs/instructions/") &&
    source.path.endsWith(".md")
      ? [{ toPath: source.path, instructionPaths: repositoryInstructionPaths(source.content) }]
      : [],
  );
  const skillCandidates = executableCandidates.filter(
    (item) => item.classification === "skill" && item.toPath.endsWith("/SKILL.md"),
  );
  const existingSkills = scan.sources.flatMap((source) =>
    source.status === "included" &&
    source.path.startsWith(".agents/skills/") &&
    source.path.endsWith("/SKILL.md")
      ? [{ toPath: source.path }]
      : [],
  );
  return {
    instructions: instructionCandidates.length > 0 ? instructionCandidates : existingInstructions,
    skills: skillCandidates.length > 0 ? skillCandidates : existingSkills,
  };
}

/**
 * Refreshes the canonical AGENTS.md instruction route block. A file that already carries the block
 * and no other change gets a managed-block operation; otherwise the refresh joins its user-file
 * reference change, so the returned map replaces the input map.
 */
export function planRepositoryInstructionRouteRefresh(input: {
  scan: RepositoryKnowledgeScan;
  generatedPaths: ReadonlySet<string>;
  executableCandidates: RepositoryLayoutCandidate[];
  referenceChanges: ReadonlyMap<string, RepositoryLayoutReferenceChange>;
}): {
  referenceChanges: Map<string, RepositoryLayoutReferenceChange>;
  managedAgentRouteOperation: KnowledgeFileOperation | null;
} {
  const { scan, generatedPaths } = input;
  const referenceChanges = new Map(input.referenceChanges);
  const routed = routedInstructionSurfaces(scan, input.executableCandidates);
  let managedAgentRouteOperation: KnowledgeFileOperation | null = null;
  const agents = scan.sources.find(
    (source): source is RepositorySource & { content: string; contentHash: string } =>
      source.path === "AGENTS.md" &&
      source.status === "included" &&
      source.content !== undefined &&
      source.contentHash !== null,
  );
  // A generated AGENTS.md is outside the scan; the structural compiler regenerates its routes.
  if (
    agents === undefined &&
    !generatedPaths.has("AGENTS.md") &&
    (routed.instructions.length > 0 || routed.skills.length > 0)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "Provider instruction normalization requires a canonical AGENTS.md source.",
    );
  }
  if (agents === undefined) return { referenceChanges, managedAgentRouteOperation };
  const block = repositoryInstructionRouteBlock({
    instructions: routed.instructions.map((item) => ({
      path: item.toPath,
      instructionPaths: item.instructionPaths ?? [],
    })),
    skills: routed.skills.map((item) => ({ path: item.toPath })),
  });
  const blockPattern =
    /<!-- lervo:begin block=repository_instruction_routes schema=\d+ -->[\s\S]*?<!-- lervo:end block=repository_instruction_routes -->\n?/gu;
  const existing = referenceChanges.get("AGENTS.md");
  const baseContent = existing?.content ?? agents.content;
  const existingBlocks = baseContent.match(blockPattern) ?? [];
  let replacedBlock = false;
  const combined =
    existingBlocks.length > 0
      ? baseContent.replace(blockPattern, () => {
          if (replacedBlock) return "";
          replacedBlock = true;
          return block;
        })
      : `${baseContent}${baseContent.endsWith("\n\n") ? "" : baseContent.endsWith("\n") ? "\n" : "\n\n"}${block}`;
  if (combined !== agents.content) {
    if (existing === undefined && (agents.content.match(blockPattern)?.length ?? 0) > 0) {
      managedAgentRouteOperation = {
        path: "AGENTS.md",
        action: "update",
        ownership: "managed_blocks",
        mediaType: "text/markdown",
        content: combined,
        expectedCurrentHash: agents.contentHash,
        desiredHash: sha256(combined),
        reason: "refresh_instruction_registry_bootstrap",
      };
    } else {
      referenceChanges.set("AGENTS.md", {
        source: agents,
        content: combined,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }
  return { referenceChanges, managedAgentRouteOperation };
}

/**
 * Rebinds a recorded Claude instruction bridge to the canonical AGENTS.md bytes this plan writes,
 * so the bridge record stays current after the migration applies.
 */
export async function planInstructionBridgeRecordOperations(input: {
  root: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  referenceChanges: ReadonlyMap<string, RepositoryLayoutReferenceChange>;
  managedAgentRouteOperation: KnowledgeFileOperation | null;
}): Promise<KnowledgeFileOperation[]> {
  const { root, referenceChanges, managedAgentRouteOperation } = input;
  const bridgeOperations: KnowledgeFileOperation[] = [];
  const canonicalInstructionChange =
    referenceChanges.get("AGENTS.md") ??
    (managedAgentRouteOperation?.content === undefined
      ? undefined
      : { content: managedAgentRouteOperation.content });
  const existingInstructionBridgeRecords = await listKnowledgeArtifactPaths({
    root,
    directory: ".lervo/knowledge/instruction-bridges",
    extension: "yaml",
    maximumFiles: 64,
  });
  if (
    canonicalInstructionChange === undefined ||
    existingInstructionBridgeRecords.length === 0 ||
    !(await repositoryPathExists(resolve(root, "CLAUDE.md")))
  )
    return bridgeOperations;
  const bridge = await createKnowledgeInstructionBridgePlan({
    repositoryRoot: root,
    provider: "claude",
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  if (bridge.target.action !== "unchanged")
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The instruction bridge target must be current before repository layout migration.",
    );
  const currentRecord = bridge.operations.find(
    (operation): operation is KnowledgeFileOperation =>
      operation.path === bridge.bridgeRecordPath && operation.ownership !== "user",
  );
  if (currentRecord === undefined || currentRecord.action === "conflict")
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The instruction bridge record cannot be bound to the layout migration.",
    );
  const content = stringify(
    {
      schemaVersion: 1,
      bridgeId: bridge.bridgeId,
      profile: {
        id: bridge.profile.profileId,
        version: bridge.profile.profileVersion,
        provider: bridge.profile.provider,
        discoveryContract: bridge.profile.discoveryContract,
      },
      canonical: {
        path: bridge.profile.canonicalPath,
        contentHash: sha256(canonicalInstructionChange.content),
      },
      target: {
        path: bridge.profile.targetPath,
        contentHash:
          referenceChanges.get(bridge.profile.targetPath) === undefined
            ? bridge.target.afterHash
            : sha256(referenceChanges.get(bridge.profile.targetPath)!.content),
        blockId: bridge.profile.blockId,
        managedContentHash: bridge.target.managedContentHash,
      },
    },
    { lineWidth: 0, sortMapEntries: true },
  );
  const desiredHash = sha256(content);
  bridgeOperations.push(
    currentRecord.action === "create"
      ? { ...currentRecord, content, desiredHash }
      : currentRecord.desiredHash === desiredHash
        ? { ...currentRecord, action: "unchanged", desiredHash }
        : {
            path: bridge.bridgeRecordPath,
            action: "update",
            ownership: "lervo_generated",
            mediaType: "application/yaml",
            content,
            expectedCurrentHash:
              currentRecord.action === "unchanged"
                ? currentRecord.desiredHash
                : currentRecord.expectedCurrentHash!,
            desiredHash,
          },
  );
  return bridgeOperations;
}
