import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";

import { createManagedBlockPatchCandidate, parseManagedMarkdownBlocks } from "@lervo/documents";
import { parse, stringify } from "yaml";

import { shardedKnowledgeArtifactPath } from "./artifact-paths.js";
import {
  createKnowledgeMigrationPlanForScan,
  matchesRecordedStructuralGeneration,
  scanConfiguredRepositoryKnowledge,
} from "./compiler.js";
import {
  applyDurableKnowledgeOperations,
  type DurableKnowledgeUserFileOperation,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { upsertRepositoryKnowledgeScanSource } from "./scanner.js";
import { loadStoredConcepts } from "./store-reader.js";
import {
  RepositoryKnowledgeError,
  type KnowledgeFileOperation,
  type RepositoryKnowledgeScanOptions,
} from "./types.js";

export type InstructionBridgeProvider = "claude";

export interface InstructionBridgeProfile {
  profileId: "claude_agents_import_v1";
  profileVersion: 1;
  provider: "claude";
  canonicalPath: "AGENTS.md";
  targetPath: "CLAUDE.md";
  blockId: "provider_entry";
  discoveryContract: "claude-code-memory-import";
}

export interface KnowledgeInstructionBridgePlan {
  schemaVersion: 1;
  planId: string;
  operationId: string;
  approvalHash: string;
  status: "review_required" | "ready" | "current";
  projectId: string;
  repositoryRoot: string;
  sourceSnapshotId: string;
  afterSourceSnapshotId: string;
  policyHash: string;
  coverage: {
    included: number;
    excluded: number;
    unsupported: number;
    includedBytes: number;
    complete: boolean;
  };
  registryDigest: string;
  afterRegistryDigest: string;
  profile: InstructionBridgeProfile;
  canonical: { path: string; contentHash: string; byteCount: number };
  target: {
    path: string;
    action: "create" | "update" | "unchanged";
    beforeHash: string | null;
    afterHash: string;
    beforeByteCount: number | null;
    afterByteCount: number;
    managedContentHash: string;
  };
  bridgeId: string;
  bridgeRecordPath: string;
  createdConceptIds: string[];
  updatedConceptIds: string[];
  deprecatedConceptIds: string[];
  operations: Array<KnowledgeFileOperation | DurableKnowledgeUserFileOperation>;
}

export interface KnowledgeInstructionBridgeReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  operation: "instruction_bridge_update";
  planId: string;
  operationId: string;
  projectId: string;
  sourceSnapshotId: string;
  afterSourceSnapshotId: string;
  approvalHash: string | null;
  provider: InstructionBridgeProvider;
  profileId: InstructionBridgeProfile["profileId"];
  canonicalPathDigest: string;
  targetPathDigest: string;
  targetAfterHash: string;
  bridgeId: string;
  appliedAt: string;
}

const HASH = /^sha256:[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const profiles: Readonly<Record<InstructionBridgeProvider, InstructionBridgeProfile>> = {
  claude: {
    profileId: "claude_agents_import_v1",
    profileVersion: 1,
    provider: "claude",
    canonicalPath: "AGENTS.md",
    targetPath: "CLAUDE.md",
    blockId: "provider_entry",
    discoveryContract: "claude-code-memory-import",
  },
};

export function instructionBridgeProfile(
  provider: InstructionBridgeProvider,
): InstructionBridgeProfile {
  return profiles[provider];
}

function managedContent(profile: InstructionBridgeProfile): string {
  return `@${profile.canonicalPath}\n`;
}

function completeTarget(profile: InstructionBridgeProfile): string {
  return [
    `<!-- lervo:begin block=${profile.blockId} schema=1 -->`,
    `@${profile.canonicalPath}`,
    `<!-- lervo:end block=${profile.blockId} -->`,
    "",
  ].join("\n");
}

function validExistingBridgeRecord(
  bytes: Buffer,
  profile: InstructionBridgeProfile,
  bridgeId: string,
): boolean {
  try {
    const value = parse(bytes.toString("utf8")) as {
      schemaVersion?: unknown;
      bridgeId?: unknown;
      profile?: {
        id?: unknown;
        version?: unknown;
        provider?: unknown;
        discoveryContract?: unknown;
      };
      canonical?: { path?: unknown; contentHash?: unknown };
      target?: {
        path?: unknown;
        contentHash?: unknown;
        blockId?: unknown;
        managedContentHash?: unknown;
      };
    } | null;
    return (
      value !== null &&
      typeof value === "object" &&
      value.schemaVersion === 1 &&
      value.bridgeId === bridgeId &&
      value.profile?.id === profile.profileId &&
      value.profile.version === profile.profileVersion &&
      value.profile.provider === profile.provider &&
      value.profile.discoveryContract === profile.discoveryContract &&
      value.canonical?.path === profile.canonicalPath &&
      typeof value.canonical.contentHash === "string" &&
      HASH.test(value.canonical.contentHash) &&
      value.target?.path === profile.targetPath &&
      value.target.blockId === profile.blockId &&
      typeof value.target.contentHash === "string" &&
      HASH.test(value.target.contentHash) &&
      typeof value.target.managedContentHash === "string" &&
      HASH.test(value.target.managedContentHash)
    );
  } catch {
    return false;
  }
}

async function safeOptionalFile(path: string, maximumBytes: number): Promise<Buffer | null> {
  let handle;
  try {
    try {
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maximumBytes)
        throw new Error("unsafe file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      !before.isFile() ||
      before.size > maximumBytes ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    )
      throw new Error("file changed");
    return bytes;
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The instruction bridge file cannot be read safely.",
    );
  } finally {
    await handle?.close();
  }
}

function targetOutput(input: {
  profile: InstructionBridgeProfile;
  existing: { content: string; contentHash: string; byteCount: number } | null;
}): { content: string; action: "create" | "update" | "unchanged"; managedContentHash: string } {
  const replacement = managedContent(input.profile);
  const managedContentHash = sha256(replacement);
  if (input.existing === null)
    return { content: completeTarget(input.profile), action: "create", managedContentHash };
  const sourceBytes = encoder.encode(input.existing.content);
  const parsed = parseManagedMarkdownBlocks(sourceBytes);
  if (parsed.status !== "valid") {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The provider instruction target has an invalid managed-block structure.",
    );
  }
  const block = parsed.blocks.find((item) => item.blockId === input.profile.blockId);
  if (block === undefined) {
    const separator =
      input.existing.content.length === 0 || input.existing.content.endsWith("\n\n")
        ? ""
        : input.existing.content.endsWith("\n")
          ? "\n"
          : "\n\n";
    return {
      content: `${input.existing.content}${separator}${completeTarget(input.profile)}`,
      action: "update",
      managedContentHash,
    };
  }
  const current = sourceBytes.slice(block.contentRange.start, block.contentRange.end);
  if (sha256(current) === managedContentHash && decoder.decode(current) === replacement) {
    return { content: input.existing.content, action: "unchanged", managedContentHash };
  }
  const patched = createManagedBlockPatchCandidate({
    source: {
      path: input.profile.targetPath,
      contentHash: input.existing.contentHash,
      byteCount: input.existing.byteCount,
      bytes: sourceBytes,
    },
    blockId: input.profile.blockId,
    replacementBytes: encoder.encode(replacement),
  });
  return { content: decoder.decode(patched.outputBytes), action: "update", managedContentHash };
}

async function registryDigest(
  root: string,
): Promise<{ digest: string; materials: Array<{ file: string; contentHash: string }> }> {
  const stored = await loadStoredConcepts(root);
  if (stored.some((item) => item.value === null)) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The instruction bridge cannot be changed because the knowledge concept registry is incomplete.",
    );
  }
  const materials = await Promise.all(
    stored.map(async (item) => {
      const bytes = await safeOptionalFile(resolve(root, item.file), 256 * 1024);
      if (bytes === null)
        throw new RepositoryKnowledgeError(
          "knowledge_reconciliation_conflict",
          "A knowledge concept sidecar is missing.",
        );
      return { file: item.file, contentHash: sha256(bytes) };
    }),
  );
  materials.sort((left, right) => left.file.localeCompare(right.file));
  return { digest: sha256(canonicalJson(materials)), materials };
}

export function serializableKnowledgeInstructionBridgePlan(
  plan: KnowledgeInstructionBridgePlan,
): Omit<KnowledgeInstructionBridgePlan, "operations"> & {
  operations: Array<Omit<KnowledgeFileOperation | DurableKnowledgeUserFileOperation, "content">>;
} {
  return {
    ...plan,
    operations: plan.operations.map(({ content: _content, ...operation }) => operation),
  };
}

export async function createKnowledgeInstructionBridgePlan(input: {
  repositoryRoot: string;
  provider: InstructionBridgeProvider;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<KnowledgeInstructionBridgePlan> {
  const root = resolve(input.repositoryRoot);
  const profile = instructionBridgeProfile(input.provider);
  const [{ policy, scan }, beforeRegistry] = await Promise.all([
    scanConfiguredRepositoryKnowledge(
      root,
      input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources },
    ),
    registryDigest(root),
  ]);
  const scannedCanonical = scan.sources.find((item) => item.path === profile.canonicalPath);
  let canonical: { contentHash: string; content: string; byteCount: number };
  if (
    scannedCanonical?.status === "included" &&
    scannedCanonical.kind === "instruction" &&
    scannedCanonical.contentHash !== null &&
    scannedCanonical.content !== undefined
  ) {
    canonical = {
      contentHash: scannedCanonical.contentHash,
      content: scannedCanonical.content,
      byteCount: scannedCanonical.byteCount,
    };
  } else {
    const generatedBytes = await safeOptionalFile(
      resolve(root, profile.canonicalPath),
      policy.limits.maxFileBytes,
    );
    const generatedHash = generatedBytes === null ? null : sha256(generatedBytes);
    if (
      generatedBytes === null ||
      generatedHash === null ||
      !(await matchesRecordedStructuralGeneration(root, profile.canonicalPath, generatedHash))
    ) {
      throw new RepositoryKnowledgeError(
        "knowledge_reconciliation_conflict",
        "Canonical AGENTS.md must be either an included instruction source or an exact recorded Lervo generation.",
      );
    }
    canonical = {
      contentHash: generatedHash,
      content: decoder.decode(generatedBytes),
      byteCount: generatedBytes.byteLength,
    };
  }
  const targetSource = scan.sources.find((item) => item.path === profile.targetPath);
  if (
    targetSource !== undefined &&
    (targetSource.status !== "included" ||
      targetSource.kind !== "instruction" ||
      targetSource.contentHash === null ||
      targetSource.content === undefined)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The provider instruction target is not a safe included instruction.",
    );
  }
  if (targetSource === undefined) {
    const existing = await safeOptionalFile(
      resolve(root, profile.targetPath),
      policy.limits.maxFileBytes,
    );
    if (existing !== null)
      throw new RepositoryKnowledgeError(
        "knowledge_reconciliation_conflict",
        "The provider instruction target does not match the scan.",
      );
  }
  const target = targetOutput({
    profile,
    existing:
      targetSource === undefined
        ? null
        : {
            content: targetSource.content!,
            contentHash: targetSource.contentHash!,
            byteCount: targetSource.byteCount,
          },
  });
  if (Buffer.byteLength(target.content) > policy.limits.maxFileBytes) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      "The instruction bridge output exceeds the file-size limit.",
    );
  }
  const targetAfterHash = sha256(target.content);
  const virtualScan = upsertRepositoryKnowledgeScanSource({
    scan,
    path: profile.targetPath,
    content: target.content,
  });
  const structural = await createKnowledgeMigrationPlanForScan({
    repositoryRoot: root,
    scan: virtualScan,
    mode: "refresh",
  });
  if (
    structural.status !== "ready" ||
    structural.operations.some((item) => item.action === "conflict")
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "Generated publications cannot be updated safely after the instruction bridge change.",
    );
  }
  const bridgeId = stableId("kbridge", {
    projectId: scan.projectId,
    provider: profile.provider,
    canonicalPath: profile.canonicalPath,
    targetPath: profile.targetPath,
  });
  const bridgeRecordPath = shardedKnowledgeArtifactPath(
    ".lervo/knowledge/instruction-bridges",
    bridgeId,
    "yaml",
  );
  const bridgeRecordContent = stringify(
    {
      schemaVersion: 1,
      bridgeId,
      profile: {
        id: profile.profileId,
        version: profile.profileVersion,
        provider: profile.provider,
        discoveryContract: profile.discoveryContract,
      },
      canonical: { path: profile.canonicalPath, contentHash: canonical.contentHash },
      target: {
        path: profile.targetPath,
        contentHash: targetAfterHash,
        blockId: profile.blockId,
        managedContentHash: target.managedContentHash,
      },
    },
    { lineWidth: 0, sortMapEntries: true },
  );
  const bridgeRecordBytes = await safeOptionalFile(resolve(root, bridgeRecordPath), 64 * 1024);
  const bridgeRecordHash = sha256(bridgeRecordContent);
  const bridgeRecordOperation: KnowledgeFileOperation =
    bridgeRecordBytes === null
      ? {
          path: bridgeRecordPath,
          action: "create",
          ownership: "lervo_generated",
          mediaType: "application/yaml",
          content: bridgeRecordContent,
          desiredHash: bridgeRecordHash,
        }
      : sha256(bridgeRecordBytes) === bridgeRecordHash
        ? {
            path: bridgeRecordPath,
            action: "unchanged",
            ownership: "lervo_generated",
            mediaType: "application/yaml",
            desiredHash: bridgeRecordHash,
          }
        : validExistingBridgeRecord(bridgeRecordBytes, profile, bridgeId)
          ? {
              path: bridgeRecordPath,
              action: "update",
              ownership: "lervo_generated",
              mediaType: "application/yaml",
              content: bridgeRecordContent,
              expectedCurrentHash: sha256(bridgeRecordBytes),
              desiredHash: bridgeRecordHash,
            }
          : (() => {
              throw new RepositoryKnowledgeError(
                "knowledge_reconciliation_conflict",
                "The existing instruction bridge record does not satisfy the profile contract.",
              );
            })();
  const targetOperation: DurableKnowledgeUserFileOperation | null =
    target.action === "unchanged"
      ? null
      : {
          path: profile.targetPath,
          action: target.action,
          ownership: "user",
          mediaType: "text/markdown",
          content: target.content,
          ...(targetSource?.contentHash === null || targetSource?.contentHash === undefined
            ? {}
            : { expectedCurrentHash: targetSource.contentHash }),
          desiredHash: targetAfterHash,
        };
  const operations: Array<KnowledgeFileOperation | DurableKnowledgeUserFileOperation> = [
    ...structural.operations,
    bridgeRecordOperation,
    ...(targetOperation === null ? [] : [targetOperation]),
  ];
  const conceptOperations = structural.operations.filter(
    (item) => item.path.startsWith(".lervo/knowledge/concepts/") && item.action !== "conflict",
  );
  const afterHashes = new Map(
    beforeRegistry.materials.map((item) => [item.file, item.contentHash]),
  );
  for (const item of conceptOperations) afterHashes.set(item.path, item.desiredHash);
  const afterRegistryDigest = sha256(
    canonicalJson(
      [...afterHashes]
        .map(([file, contentHash]) => ({ file, contentHash }))
        .sort((left, right) => left.file.localeCompare(right.file)),
    ),
  );
  const conceptIdFor = (path: string): string =>
    path.slice(path.lastIndexOf("/") + 1, -".yaml".length);
  const createdConceptIds = conceptOperations
    .filter((item) => item.action === "create")
    .map((item) => conceptIdFor(item.path))
    .sort();
  const updatedConceptIds = conceptOperations
    .filter((item) => item.action === "update")
    .map((item) => conceptIdFor(item.path))
    .sort();
  const operationId = stableId("kinstop", {
    projectId: scan.projectId,
    profile,
    canonicalHash: canonical.contentHash,
    targetBeforeHash: targetSource?.contentHash ?? null,
    targetAfterHash,
    managedContentHash: target.managedContentHash,
  });
  const operationBindings = operations.map(({ content: _content, ...operation }) => operation);
  const approvalHash = sha256(
    canonicalJson({
      operationId,
      action: "ensure_instruction_bridge",
      profile,
      canonical: {
        path: profile.canonicalPath,
        contentHash: canonical.contentHash,
        byteCount: canonical.byteCount,
      },
      target: {
        path: profile.targetPath,
        action: target.action,
        beforeHash: targetSource?.contentHash ?? null,
        afterHash: targetAfterHash,
      },
      bridgeId,
      operations: operationBindings,
    }),
  );
  const policyHash = sha256(canonicalJson(policy));
  const planId = stableId("kbridgeplan", {
    projectId: scan.projectId,
    sourceSnapshotId: scan.snapshotId,
    afterSourceSnapshotId: virtualScan.snapshotId,
    policyHash,
    registryDigest: beforeRegistry.digest,
    afterRegistryDigest,
    operationId,
    approvalHash,
    operations: operationBindings,
  });
  const changed = operations.some((item) => item.action === "create" || item.action === "update");
  return {
    schemaVersion: 1,
    planId,
    operationId,
    approvalHash,
    status: targetOperation !== null ? "review_required" : changed ? "ready" : "current",
    projectId: scan.projectId,
    repositoryRoot: root,
    sourceSnapshotId: scan.snapshotId,
    afterSourceSnapshotId: virtualScan.snapshotId,
    policyHash,
    coverage: scan.coverage,
    registryDigest: beforeRegistry.digest,
    afterRegistryDigest,
    profile,
    canonical: {
      path: profile.canonicalPath,
      contentHash: canonical.contentHash,
      byteCount: canonical.byteCount,
    },
    target: {
      path: profile.targetPath,
      action: target.action,
      beforeHash: targetSource?.contentHash ?? null,
      afterHash: targetAfterHash,
      beforeByteCount: targetSource?.byteCount ?? null,
      afterByteCount: Buffer.byteLength(target.content),
      managedContentHash: target.managedContentHash,
    },
    bridgeId,
    bridgeRecordPath,
    createdConceptIds,
    updatedConceptIds,
    deprecatedConceptIds: [],
    operations,
  };
}

export async function applyKnowledgeInstructionBridgePlan(input: {
  plan: KnowledgeInstructionBridgePlan;
  approvedOperationId?: string;
  approvedHash?: string;
  now: Date;
  recordApplied: (receipt: KnowledgeInstructionBridgeReceipt) => void | Promise<void>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<KnowledgeInstructionBridgeReceipt> {
  if (input.plan.status === "current") {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The instruction bridge is already current, so there is no change to apply.",
    );
  }
  if (
    input.plan.status === "review_required" &&
    (input.approvedOperationId !== input.plan.operationId ||
      input.approvedHash === undefined ||
      !HASH.test(input.approvedHash) ||
      input.approvedHash !== input.plan.approvalHash)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "An instruction bridge change requires an operation ID and exact approval hash.",
    );
  }
  if (
    input.plan.status === "ready" &&
    (input.approvedOperationId !== undefined || input.approvedHash !== undefined)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "Item approval is not used when an instruction bridge plan does not change the user target.",
    );
  }
  const current = await createKnowledgeInstructionBridgePlan({
    repositoryRoot: input.plan.repositoryRoot,
    provider: input.plan.profile.provider,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  if (current.planId !== input.plan.planId) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The instruction, bridge record, registry, policy, or source snapshot changed after planning.",
    );
  }
  const receipt: KnowledgeInstructionBridgeReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    operation: "instruction_bridge_update",
    planId: current.planId,
    operationId: current.operationId,
    projectId: current.projectId,
    sourceSnapshotId: current.sourceSnapshotId,
    afterSourceSnapshotId: current.afterSourceSnapshotId,
    approvalHash: current.status === "review_required" ? current.approvalHash : null,
    provider: current.profile.provider,
    profileId: current.profile.profileId,
    canonicalPathDigest: sha256(current.canonical.path),
    targetPathDigest: sha256(current.target.path),
    targetAfterHash: current.target.afterHash,
    bridgeId: current.bridgeId,
    appliedAt: input.now.toISOString(),
  };
  return applyDurableKnowledgeOperations({
    repositoryRoot: current.repositoryRoot,
    projectId: current.projectId,
    planId: current.planId,
    operations: current.operations,
    receipt,
    recordApplied: input.recordApplied,
    ...(input.failureInjector === undefined ? {} : { failureInjector: input.failureInjector }),
  });
}
