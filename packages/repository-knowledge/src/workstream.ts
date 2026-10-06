import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, posix, relative, resolve, sep } from "node:path";

import { hasWorkstreamPredecessor, validateSchema, type WorkstreamSnapshot } from "@lervo/schemas";
import {
  applyDurableKnowledgeOperations,
  type DurableKnowledgeDeleteOperation,
  type DurableKnowledgeUserFileOperation,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { normalizationRecordRetirementOperations } from "./document-normalization-record-retirement.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { pendingCoordinatesValid, snapshotFromStartDraft } from "./workstream-snapshot.js";
import { workstreamIntentHash, type WorkstreamBookkeeping } from "./workstream-bookkeeping.js";
import { scanConfiguredRepositoryKnowledge } from "./compiler.js";
import {
  declaredContinuationSource,
  LEGACY_CONTINUATION_ALIAS,
} from "./continuation-source-declaration.js";
import {
  RepositoryKnowledgeError,
  type KnowledgeFileOperation,
  type RepositoryKnowledgeScanOptions,
  type RepositorySource,
} from "./types.js";

const HANDOFF_PATH = LEGACY_CONTINUATION_ALIAS;
const CURRENT_WORKSTREAM_PATH = ".lervo/state/workstreams/current.json";
const MAX_HANDOFF_BYTES = 128 * 1024;
const HASH = /^sha256:[a-f0-9]{64}$/u;

interface SafeTextFile {
  content: string;
  contentHash: string;
  byteCount: number;
  modifiedAt: string;
}

export interface WorkstreamReferenceUpdate {
  path: string;
  beforeHash: string;
  afterHash: string;
  replacementCount: number;
}

export interface ContinuationWorkstreamMigrationPlan {
  schemaVersion: 1;
  planKind: "continuation_workstream";
  planId: string;
  status: "current" | "review_required" | "blocked";
  projectId: string;
  repositoryRoot: string;
  sourcePath: string | null;
  sourceContentHash: string | null;
  sourceByteCount: number;
  sourceDisposition: "delete_dedicated_legacy" | "preserve_for_document_normalization" | null;
  workstreamPath: typeof CURRENT_WORKSTREAM_PATH;
  workstream: WorkstreamSnapshot | null;
  snapshotContentHash: string | null;
  operationId: string | null;
  approvalHash: string | null;
  referenceUpdates: WorkstreamReferenceUpdate[];
  removedNormalizationRecords: string[];
  candidates: ContinuationSourceCandidate[];
  blockers: Array<{
    code:
      | "current_workstream_conflict"
      | "invalid_current_workstream"
      | "ambiguous_continuation_sources"
      | "invalid_continuation_source";
    message: string;
  }>;
  operations: Array<
    KnowledgeFileOperation | DurableKnowledgeDeleteOperation | DurableKnowledgeUserFileOperation
  >;
}

export interface ContinuationWorkstreamMigrationReceipt {
  schemaVersion: 1;
  type: "workstream.snapshot.recorded";
  operation: "legacy_continuation_migration";
  planId: string;
  projectId: string;
  workstreamId: string;
  revision: number;
  status: WorkstreamSnapshot["status"];
  sourceContentHash: string;
  snapshotContentHash: string;
  previousSnapshotContentHash: string | null;
  approvalHash: string;
  referenceUpdatedCount: number;
  normalizationRecordRemovedCount: number;
  sourceDisposition: Exclude<ContinuationWorkstreamMigrationPlan["sourceDisposition"], null>;
  appliedAt: string;
}

/**
 * ADR-0476: a continuation source is only what the repository declares, never what its file name
 * or headings resemble: the dedicated legacy `HANDOFF.md` alias of the `continuation_source`
 * role, `lervo.workstream.continuation: true` front matter, or an exact `--source` selection.
 */
export interface ContinuationSourceCandidate {
  path: string;
  contentHash: string;
  signals: Array<"explicit_selection" | "explicit_metadata" | "declared_legacy_alias">;
}

export interface WorkstreamUpdatePlan {
  schemaVersion: 1;
  planKind: "workstream_update";
  planId: string;
  status: "ready" | "blocked";
  projectId: string;
  repositoryRoot: string;
  currentSnapshotContentHash: string | null;
  desiredSnapshotContentHash: string | null;
  snapshot: WorkstreamSnapshot | null;
  blockers: Array<{
    code:
      | "missing_current_workstream"
      | "invalid_revision"
      | "identity_changed"
      | "origin_changed"
      | "invalid_snapshot"
      | "invalid_patch";
    message: string;
  }>;
  operations: KnowledgeFileOperation[];
}

export interface WorkstreamUpdateReceipt {
  schemaVersion: 1;
  type: "workstream.snapshot.recorded";
  operation: "user_update" | "agent_update";
  planId: string;
  projectId: string;
  workstreamId: string;
  revision: number;
  status: WorkstreamSnapshot["status"];
  snapshotContentHash: string;
  previousSnapshotContentHash: string;
  appliedAt: string;
}

export interface WorkstreamStartDraft {
  schemaVersion: 1;
  status: WorkstreamSnapshot["status"];
  title: string;
  objective: string;
  nextActions: string[];
  blockers: string[];
  notes: string[];
  references: WorkstreamSnapshot["references"];
  pendingDecisions?: NonNullable<WorkstreamSnapshot["pendingDecisions"]>;
  pendingApprovals?: NonNullable<WorkstreamSnapshot["pendingApprovals"]>;
  /** Ignored when the service stamps bookkeeping. */
  updatedAt?: string;
}

export interface WorkstreamStartPlan {
  schemaVersion: 1;
  planKind: "workstream_start";
  planId: string;
  status: "ready" | "blocked";
  projectId: string;
  repositoryRoot: string;
  currentSnapshotContentHash: string | null;
  desiredSnapshotContentHash: string | null;
  snapshot: WorkstreamSnapshot | null;
  blockers: Array<{ code: "current_workstream_exists" | "invalid_draft"; message: string }>;
  operations: KnowledgeFileOperation[];
  /** Service-stamped write facts; null when the caller supplied an exact draft. */
  bookkeeping: WorkstreamBookkeeping | null;
}

export interface WorkstreamStartReceipt {
  schemaVersion: 1;
  type: "workstream.snapshot.recorded";
  operation: "user_start" | "agent_start";
  planId: string;
  projectId: string;
  workstreamId: string;
  revision: 1;
  status: WorkstreamSnapshot["status"];
  snapshotContentHash: string;
  previousSnapshotContentHash: string | null;
  appliedAt: string;
}

export interface ReplicatedWorkstreamImportPlan {
  schemaVersion: 1;
  planKind: "replicated_workstream_import";
  planId: string;
  status: "current" | "ready" | "blocked";
  projectId: string;
  repositoryRoot: string;
  currentSnapshotContentHash: string | null;
  desiredSnapshotContentHash: string;
  previousSnapshotContentHash: string | null;
  snapshot: WorkstreamSnapshot;
  blockers: Array<{
    code: "invalid_snapshot" | "identity_changed" | "origin_changed" | "non_advancing_revision";
    message: string;
  }>;
  operations: KnowledgeFileOperation[];
}

export interface ReplicatedWorkstreamImportReceipt {
  schemaVersion: 1;
  type: "workstream.snapshot.recorded";
  operation: "hub_replication_import";
  planId: string;
  projectId: string;
  workstreamId: string;
  revision: number;
  status: WorkstreamSnapshot["status"];
  snapshotContentHash: string;
  previousSnapshotContentHash: string | null;
  appliedAt: string;
}

function insideRoot(root: string, path: string): string {
  const target = resolve(root, path);
  const child = relative(root, target);
  if (child === ".." || child.startsWith(`..${sep}`)) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "A workstream path escapes the repository.",
    );
  }
  return target;
}

async function safeTextFile(
  root: string,
  path: string,
  maximumBytes: number,
): Promise<SafeTextFile | null> {
  const target = insideRoot(root, path);
  let handle;
  try {
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) {
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        "A workstream source is not a bounded regular file.",
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    ) {
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        "A workstream source changed while it was read.",
      );
    }
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return {
      content,
      contentHash: sha256(bytes),
      byteCount: bytes.byteLength,
      modifiedAt: before.mtime.toISOString(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof RepositoryKnowledgeError) throw error;
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "A workstream source cannot be read safely.",
    );
  } finally {
    await handle?.close();
  }
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/^\s*(?:[-*+] |\d+[.)] )/u, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

interface MarkdownSection {
  heading: string;
  lines: string[];
}

function sectionsOf(content: string): { title: string; sections: MarkdownSection[] } {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const title = cleanMarkdown(
    lines.find((line) => /^#\s+/u.test(line))?.replace(/^#\s+/u, "") ?? "Current workstream",
  );
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  for (const line of lines) {
    const heading = /^##+\s+(.+)$/u.exec(line);
    if (heading !== null) {
      current = { heading: cleanMarkdown(heading[1]!), lines: [] };
      sections.push(current);
    } else if (current !== null) {
      current.lines.push(line);
    }
  }
  return { title: title || "Current workstream", sections };
}

function sectionItems(section: MarkdownSection): string[] {
  const listItems = section.lines
    .filter((line) => /^\s*(?:[-*+] |\d+[.)] )/u.test(line))
    .map(cleanMarkdown)
    .filter(Boolean);
  if (listItems.length > 0) return listItems;
  const paragraphs = section.lines
    .join("\n")
    .split(/\n\s*\n/gu)
    .map(cleanMarkdown)
    .filter(Boolean);
  return paragraphs;
}

function bounded(items: string[], maximumItems: number, maximumLength: number): string[] {
  return items
    .slice(0, maximumItems)
    .map((item) => item.slice(0, maximumLength))
    .filter(Boolean);
}

function referencesOf(sections: MarkdownSection[]): WorkstreamSnapshot["references"] {
  const candidates = sections
    .filter((section) => /reference|source|authority|authoritative/iu.test(section.heading))
    .flatMap((section) => section.lines)
    .flatMap((line) => {
      const label = cleanMarkdown(line).slice(0, 200) || "Repository reference";
      const paths = [
        ...line.matchAll(
          /(?:`|\()((?:\.?\.?\/)?[A-Za-z0-9_.@()+-]+(?:\/[A-Za-z0-9_.@()+-]+)+\.(?:md|mdx|json|ya?ml))(?:`|\))/gu,
        ),
      ]
        .map((match) => match[1]!)
        .map((path) => path.replace(/^\.\//u, ""));
      return paths.map((path) => ({ path, label }));
    })
    .filter(
      (item) =>
        !item.path.startsWith("../") && !item.path.startsWith("/") && !item.path.includes("\\"),
    );
  return [...new Map(candidates.map((item) => [item.path, item])).values()].slice(0, 32);
}

function workstreamFromContinuation(
  projectId: string,
  sourcePath: string,
  source: SafeTextFile,
): WorkstreamSnapshot {
  const parsed = sectionsOf(source.content);
  const objectiveSections = parsed.sections.filter((section) =>
    /objective|goal|purpose|focus/iu.test(section.heading),
  );
  const actionSections = parsed.sections.filter((section) =>
    /resume|next|action|procedure|task|continue/iu.test(section.heading),
  );
  const blockerSections = parsed.sections.filter((section) =>
    /block|risk|issue/iu.test(section.heading),
  );
  const referenceSections = parsed.sections.filter((section) =>
    /reference|source|authority|authoritative/iu.test(section.heading),
  );
  const claimed = new Set([
    ...objectiveSections,
    ...actionSections,
    ...blockerSections,
    ...referenceSections,
  ]);
  const objective =
    objectiveSections.flatMap(sectionItems).join(" ").slice(0, 8192) || parsed.title;
  const notes = parsed.sections
    .filter((section) => !claimed.has(section))
    .flatMap((section) => sectionItems(section).map((item) => `${section.heading}: ${item}`));
  const sourceArtifactId = `art_${source.contentHash.slice("sha256:".length)}`;
  return {
    schemaVersion: 1,
    workstreamId: stableId("wks", { projectId, sourceContentHash: source.contentHash }),
    revision: 1,
    status:
      blockerSections.length > 0 &&
      blockerSections.some((section) => sectionItems(section).length > 0)
        ? "blocked"
        : "active",
    title: parsed.title.slice(0, 200),
    objective,
    nextActions: bounded(actionSections.flatMap(sectionItems), 32, 1024),
    blockers: bounded(blockerSections.flatMap(sectionItems), 16, 1024),
    notes: bounded(notes, 32, 2048),
    references: referencesOf(parsed.sections),
    origin: {
      kind: "legacy_continuation",
      sourceArtifactId,
      sourceContentHash: source.contentHash,
      sourcePathDigest: sha256(sourcePath),
    },
    updatedAt: source.modifiedAt,
  };
}

function replaceContinuationReferences(
  content: string,
  ownerPath: string,
  sourcePath: string,
): { content: string; count: number } {
  let count = 0;
  const replace = (pattern: RegExp, replacement: string): void => {
    content = content.replace(pattern, () => {
      count += 1;
      return replacement;
    });
  };
  if (sourcePath === HANDOFF_PATH) {
    replace(/procedure in `HANDOFF\.md`/gu, "procedure in the returned workstream context");
    replace(/read (?:the )?root `HANDOFF\.md`/giu, "run `lervo workstream current`");
    replace(/read `HANDOFF\.md`/giu, "run `lervo workstream current`");
    replace(
      /Follow root `HANDOFF\.md`/gu,
      "Follow the current workstream from `lervo workstream current`",
    );
    replace(
      /follow root `HANDOFF\.md`/gu,
      "follow the current workstream from `lervo workstream current`",
    );
    replace(/Root `HANDOFF\.md`/gu, "Current workstream (`lervo workstream current`)");
    replace(/root `HANDOFF\.md`/gu, "the current workstream from `lervo workstream current`");
  }
  content = content.replace(
    /\[([^\]]+)\]\(([^)\s#]+)(?:#[^)\s]+)?\)/gu,
    (whole, _label: string, target: string) => {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target) || target.startsWith("/")) return whole;
      const resolved = posix.normalize(posix.join(posix.dirname(ownerPath), target));
      if (resolved !== sourcePath) return whole;
      count += 1;
      return "the current workstream from `lervo workstream current`";
    },
  );
  const relativeTarget =
    posix.relative(posix.dirname(ownerPath), sourcePath) || basename(sourcePath);
  for (const literal of new Set([
    sourcePath,
    `./${sourcePath}`,
    relativeTarget,
    `./${relativeTarget}`,
  ])) {
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    replace(
      new RegExp(`\`${escaped}\``, "gu"),
      "the current workstream from `lervo workstream current`",
    );
  }
  if (sourcePath === HANDOFF_PATH) {
    replace(
      /(?<![A-Za-z0-9_./-])HANDOFF\.md(?![A-Za-z0-9_./-])/gu,
      "the current workstream from `lervo workstream current`",
    );
  }
  return { content, count };
}

async function referenceOperations(
  root: string,
  sources: RepositorySource[],
  sourcePath: string,
): Promise<{
  updates: WorkstreamReferenceUpdate[];
  operations: DurableKnowledgeUserFileOperation[];
}> {
  const updates: WorkstreamReferenceUpdate[] = [];
  const operations: DurableKnowledgeUserFileOperation[] = [];
  for (const item of sources) {
    if (
      item.status !== "included" ||
      item.content === undefined ||
      item.contentHash === null ||
      !/\.mdx?$/iu.test(item.path) ||
      item.path === sourcePath ||
      item.path === "docs/knowledge/index.md" ||
      item.path.startsWith("docs/knowledge/") ||
      (!item.content.includes(sourcePath) && !item.content.includes(basename(sourcePath)))
    )
      continue;
    const source = await safeTextFile(root, item.path, 1024 * 1024);
    if (source === null || source.contentHash !== item.contentHash) {
      throw new RepositoryKnowledgeError(
        "knowledge_plan_stale",
        "A HANDOFF reference source changed after repository scanning.",
      );
    }
    const replaced = replaceContinuationReferences(source.content, item.path, sourcePath);
    if (replaced.count === 0 || replaced.content === source.content) continue;
    const afterHash = sha256(replaced.content);
    updates.push({
      path: item.path,
      beforeHash: source.contentHash,
      afterHash,
      replacementCount: replaced.count,
    });
    operations.push({
      path: item.path,
      action: "update",
      ownership: "user",
      mediaType: "text/markdown",
      content: replaced.content,
      expectedCurrentHash: source.contentHash,
      desiredHash: afterHash,
    });
  }
  return { updates, operations };
}

export async function readCurrentWorkstream(
  repositoryRoot: string,
): Promise<WorkstreamSnapshot | null> {
  return (await readCurrentWorkstreamState(repositoryRoot))?.snapshot ?? null;
}

export async function readCurrentWorkstreamState(
  repositoryRoot: string,
): Promise<{ snapshot: WorkstreamSnapshot; content: string; contentHash: string } | null> {
  const source = await safeTextFile(resolve(repositoryRoot), CURRENT_WORKSTREAM_PATH, 64 * 1024);
  if (source === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(source.content);
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The current workstream state is not valid JSON.",
    );
  }
  if (
    !validateSchema("workstreamSnapshot", value).valid ||
    !pendingCoordinatesValid(value as WorkstreamSnapshot)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The current workstream state does not satisfy the v1 contract.",
    );
  }
  return {
    snapshot: value as WorkstreamSnapshot,
    content: source.content,
    contentHash: source.contentHash,
  };
}

export async function restoreCurrentWorkstreamState(input: {
  repositoryRoot: string;
  content: Uint8Array;
  expectedHash: string;
}): Promise<WorkstreamSnapshot> {
  const root = resolve(input.repositoryRoot);
  const content = Buffer.from(input.content).toString("utf8");
  if (input.content.byteLength > 64 * 1024 || sha256(input.content) !== input.expectedHash) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The workstream recovery artifact is invalid.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The workstream recovery artifact is not valid JSON.",
    );
  }
  if (
    `${canonicalJson(value)}\n` !== content ||
    !validateSchema("workstreamSnapshot", value).valid ||
    !pendingCoordinatesValid(value as WorkstreamSnapshot)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The workstream recovery artifact does not satisfy the v1 contract.",
    );
  }
  const directory = resolve(root, dirname(CURRENT_WORKSTREAM_PATH));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The workstream projection directory is unsafe.",
    );
  }
  const target = resolve(root, CURRENT_WORKSTREAM_PATH);
  const temporary = `${target}.restore-${process.pid}`;
  await rm(temporary, { force: true });
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await handle.writeFile(input.content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  return value as WorkstreamSnapshot;
}

export async function createWorkstreamStartPlan(input: {
  repositoryRoot: string;
  projectId: string;
  draft: unknown;
  /** When present the service owns update time, HEAD observation, and note retention. */
  bookkeeping?: WorkstreamBookkeeping;
}): Promise<WorkstreamStartPlan> {
  const root = resolve(input.repositoryRoot);
  const blockers: WorkstreamStartPlan["blockers"] = [];
  const currentSource = await safeTextFile(root, CURRENT_WORKSTREAM_PATH, 64 * 1024);
  const current = currentSource === null ? null : await readCurrentWorkstreamState(root);
  // A settled completed or cancelled goal may have an exact-hash successor; active work may not.
  const predecessor =
    (current?.snapshot.status === "completed" || current?.snapshot.status === "cancelled") &&
    current.snapshot.blockers.length === 0 &&
    (current.snapshot.pendingDecisions?.length ?? 0) === 0 &&
    (current.snapshot.pendingApprovals?.length ?? 0) === 0
      ? { workstreamId: current.snapshot.workstreamId, contentHash: current.contentHash }
      : null;
  if (currentSource !== null && predecessor === null)
    blockers.push({
      code: "current_workstream_exists",
      message:
        "The current workstream is not settled as completed or cancelled; record its next revision with workstream update.",
    });
  const bookkeeping = input.bookkeeping ?? null;
  const snapshot = snapshotFromStartDraft(input.projectId, input.draft, predecessor, bookkeeping);
  if (snapshot === null)
    blockers.push({
      code: "invalid_draft",
      message: "The workstream start draft does not satisfy the bounded v1 fields.",
    });
  const snapshotContent = snapshot === null ? null : `${canonicalJson(snapshot)}\n`;
  const desiredSnapshotContentHash = snapshotContent === null ? null : sha256(snapshotContent);
  const planId = stableId("kwstreamplan", {
    planKind: "workstream_start",
    projectId: input.projectId,
    currentSnapshotContentHash: currentSource?.contentHash ?? null,
    desiredIntentHash: snapshot === null ? null : workstreamIntentHash(snapshot),
    blockers,
  });
  const operations: KnowledgeFileOperation[] =
    blockers.length === 0 && snapshotContent !== null && desiredSnapshotContentHash !== null
      ? [
          {
            path: CURRENT_WORKSTREAM_PATH,
            action: currentSource === null ? "create" : "update",
            ownership: "lervo_generated",
            mediaType: "application/json",
            content: snapshotContent,
            desiredHash: desiredSnapshotContentHash,
            ...(currentSource === null ? {} : { expectedCurrentHash: currentSource.contentHash }),
          },
        ]
      : [];
  return {
    schemaVersion: 1,
    planKind: "workstream_start",
    planId,
    status: blockers.length === 0 ? "ready" : "blocked",
    projectId: input.projectId,
    repositoryRoot: root,
    currentSnapshotContentHash: currentSource?.contentHash ?? null,
    desiredSnapshotContentHash,
    snapshot,
    blockers,
    operations,
    bookkeeping,
  };
}

export async function applyWorkstreamStartPlan(input: {
  plan: WorkstreamStartPlan;
  now: Date;
  actor?: "user" | "agent";
  recordApplied: (receipt: WorkstreamStartReceipt, snapshotContent: string) => void | Promise<void>;
}): Promise<WorkstreamStartReceipt> {
  if (
    input.plan.status !== "ready" ||
    input.plan.snapshot === null ||
    input.plan.desiredSnapshotContentHash === null
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The workstream start plan is not applicable.",
    );
  }
  const draft: WorkstreamStartDraft = {
    schemaVersion: 1,
    status: input.plan.snapshot.status,
    title: input.plan.snapshot.title,
    objective: input.plan.snapshot.objective,
    nextActions: input.plan.snapshot.nextActions,
    blockers: input.plan.snapshot.blockers,
    notes: input.plan.snapshot.notes,
    references: input.plan.snapshot.references,
    pendingDecisions: input.plan.snapshot.pendingDecisions ?? [],
    pendingApprovals: input.plan.snapshot.pendingApprovals ?? [],
    updatedAt: input.plan.snapshot.updatedAt,
  };
  const current = await createWorkstreamStartPlan({
    repositoryRoot: input.plan.repositoryRoot,
    projectId: input.plan.projectId,
    draft,
    ...(input.plan.bookkeeping === null ? {} : { bookkeeping: input.plan.bookkeeping }),
  });
  if (
    current.planId !== input.plan.planId ||
    current.snapshot === null ||
    current.desiredSnapshotContentHash === null
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The repository or desired workstream changed after planning.",
    );
  }
  const snapshotContent = `${canonicalJson(current.snapshot)}\n`;
  const receipt: WorkstreamStartReceipt = {
    schemaVersion: 1,
    type: "workstream.snapshot.recorded",
    operation: input.actor === "agent" ? "agent_start" : "user_start",
    planId: current.planId,
    projectId: current.projectId,
    workstreamId: current.snapshot.workstreamId,
    revision: 1,
    status: current.snapshot.status,
    snapshotContentHash: current.desiredSnapshotContentHash,
    previousSnapshotContentHash: current.currentSnapshotContentHash,
    appliedAt: input.now.toISOString(),
  };
  return applyDurableKnowledgeOperations({
    repositoryRoot: current.repositoryRoot,
    projectId: current.projectId,
    planId: current.planId,
    operations: current.operations,
    documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
      repositoryRoot: current.repositoryRoot,
      operations: current.operations,
    }),
    receipt,
    recordApplied: (applied) => input.recordApplied(applied, snapshotContent),
  });
}

function continuationCandidate(source: RepositorySource): ContinuationSourceCandidate | null {
  if (
    source.status !== "included" ||
    source.content === undefined ||
    source.contentHash === null ||
    !/\.md$/iu.test(source.path) ||
    source.path.startsWith(".lervo/")
  )
    return null;
  const declaration = declaredContinuationSource(source.path, source.content);
  return declaration === null
    ? null
    : { path: source.path, contentHash: source.contentHash, signals: [declaration] };
}

function emptyContinuationPlan(input: {
  root: string;
  projectId: string;
  candidates: ContinuationSourceCandidate[];
  blockers?: ContinuationWorkstreamMigrationPlan["blockers"];
}): ContinuationWorkstreamMigrationPlan {
  const blockers = input.blockers ?? [];
  return {
    schemaVersion: 1,
    planKind: "continuation_workstream",
    planId: stableId("kwstreamplan", {
      projectId: input.projectId,
      candidates: input.candidates,
      blockers,
    }),
    status: blockers.length === 0 ? "current" : "blocked",
    projectId: input.projectId,
    repositoryRoot: input.root,
    sourcePath: null,
    sourceContentHash: null,
    sourceByteCount: 0,
    sourceDisposition: null,
    workstreamPath: CURRENT_WORKSTREAM_PATH,
    workstream: null,
    snapshotContentHash: null,
    operationId: null,
    approvalHash: null,
    referenceUpdates: [],
    removedNormalizationRecords: [],
    candidates: input.candidates,
    blockers,
    operations: [],
  };
}

export async function createContinuationWorkstreamMigrationPlan(input: {
  repositoryRoot: string;
  projectId: string;
  sourcePath?: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<ContinuationWorkstreamMigrationPlan> {
  const root = resolve(input.repositoryRoot);
  let current: WorkstreamSnapshot | null = null;
  const blockers: ContinuationWorkstreamMigrationPlan["blockers"] = [];
  try {
    current = await readCurrentWorkstream(root);
  } catch {
    blockers.push({
      code: "invalid_current_workstream",
      message:
        "The existing current workstream must be repaired before importing continuation state.",
    });
  }
  const scan = await scanConfiguredRepositoryKnowledge(root, {
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  const candidates = scan.scan.sources
    .flatMap((item) => {
      const candidate = continuationCandidate(item);
      return candidate === null ? [] : [candidate];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  if (
    current !== null &&
    input.sourcePath === undefined &&
    !candidates.some((candidate) => candidate.path === HANDOFF_PATH) &&
    blockers.length === 0
  ) {
    return emptyContinuationPlan({ root, projectId: input.projectId, candidates });
  }
  let selected: ContinuationSourceCandidate | undefined;
  if (input.sourcePath !== undefined) {
    const normalized = input.sourcePath.replaceAll("\\", "/").replace(/^\.\//u, "");
    insideRoot(root, normalized);
    selected = candidates.find((candidate) => candidate.path === normalized);
    if (selected === undefined) {
      const explicit = scan.scan.sources.find(
        (item) =>
          item.path === normalized &&
          item.status === "included" &&
          item.content !== undefined &&
          item.contentHash !== null &&
          /\.md$/iu.test(item.path),
      );
      if (explicit === undefined)
        blockers.push({
          code: "invalid_continuation_source",
          message: "The selected path is not safely included Markdown.",
        });
      else {
        selected = {
          path: explicit.path,
          contentHash: explicit.contentHash!,
          signals: ["explicit_selection"],
        };
        candidates.unshift(selected);
      }
    }
  } else if (candidates.some((candidate) => candidate.path === HANDOFF_PATH)) {
    selected = candidates.find((candidate) => candidate.path === HANDOFF_PATH);
  } else if (candidates.length === 1) {
    selected = candidates[0];
  } else if (candidates.length > 1 && current === null) {
    blockers.push({
      code: "ambiguous_continuation_sources",
      message:
        "Multiple repository-wide continuation candidates require an exact source selection; Lervo will not merge or delete them automatically.",
    });
  }
  if (current !== null && selected === undefined && blockers.length === 0)
    return emptyContinuationPlan({ root, projectId: input.projectId, candidates });
  if (selected === undefined)
    return emptyContinuationPlan({ root, projectId: input.projectId, candidates, blockers });
  const source = await safeTextFile(root, selected.path, MAX_HANDOFF_BYTES);
  if (source === null || source.contentHash !== selected.contentHash) {
    return emptyContinuationPlan({
      root,
      projectId: input.projectId,
      candidates,
      blockers: [
        ...blockers,
        {
          code: "invalid_continuation_source",
          message: "The selected continuation source changed or became unsafe during planning.",
        },
      ],
    });
  }
  const workstream = workstreamFromContinuation(input.projectId, selected.path, source);
  if (current !== null && current.origin.sourceContentHash !== source.contentHash) {
    blockers.push({
      code: "current_workstream_conflict",
      message: "A continuation source cannot replace a different current workstream automatically.",
    });
  }
  if (
    current !== null &&
    current.origin.sourceContentHash === source.contentHash &&
    blockers.length === 0
  ) {
    return emptyContinuationPlan({ root, projectId: input.projectId, candidates });
  }
  const sourceDisposition =
    selected.path === HANDOFF_PATH
      ? ("delete_dedicated_legacy" as const)
      : ("preserve_for_document_normalization" as const);
  const references = await referenceOperations(root, scan.scan.sources, selected.path);
  const normalizations =
    sourceDisposition === "delete_dedicated_legacy"
      ? await normalizationRecordRetirementOperations(root, selected.path)
      : { paths: [], operations: [] };
  const snapshotContent = `${canonicalJson(workstream)}\n`;
  const snapshotContentHash = sha256(snapshotContent);
  const existingState = await safeTextFile(root, CURRENT_WORKSTREAM_PATH, 64 * 1024);
  const stateOperation: KnowledgeFileOperation =
    existingState === null
      ? {
          path: CURRENT_WORKSTREAM_PATH,
          action: "create",
          ownership: "lervo_generated",
          mediaType: "application/json",
          content: snapshotContent,
          desiredHash: snapshotContentHash,
        }
      : existingState.contentHash === snapshotContentHash
        ? {
            path: CURRENT_WORKSTREAM_PATH,
            action: "unchanged",
            ownership: "lervo_generated",
            mediaType: "application/json",
            desiredHash: snapshotContentHash,
            expectedCurrentHash: existingState.contentHash,
          }
        : {
            path: CURRENT_WORKSTREAM_PATH,
            action: "update",
            ownership: "lervo_generated",
            mediaType: "application/json",
            content: snapshotContent,
            desiredHash: snapshotContentHash,
            expectedCurrentHash: existingState.contentHash,
          };
  const operations: ContinuationWorkstreamMigrationPlan["operations"] = [
    stateOperation,
    ...references.operations,
    ...normalizations.operations,
    ...(sourceDisposition === "delete_dedicated_legacy"
      ? [
          {
            path: selected.path,
            action: "delete" as const,
            expectedCurrentHash: source.contentHash,
          },
        ]
      : []),
  ];
  const operationId = stableId("kwstreamop", {
    sourceContentHash: source.contentHash,
    snapshotContentHash,
    references: references.updates,
    removedNormalizationRecords: normalizations.paths,
  });
  const approvalHash = sha256(
    canonicalJson({
      operationId,
      sourcePath: selected.path,
      sourceDisposition,
      sourceContentHash: source.contentHash,
      snapshotContentHash,
      referenceUpdates: references.updates,
      removedNormalizationRecords: normalizations.paths,
    }),
  );
  const planId = stableId("kwstreamplan", {
    projectId: input.projectId,
    operationId,
    approvalHash,
    operations: operations.map((item) => ({
      path: item.path,
      action: item.action,
      desiredHash: "desiredHash" in item ? item.desiredHash : null,
      expectedCurrentHash: item.expectedCurrentHash ?? null,
    })),
  });
  return {
    schemaVersion: 1,
    planKind: "continuation_workstream",
    planId,
    status: blockers.length === 0 ? "review_required" : "blocked",
    projectId: input.projectId,
    repositoryRoot: root,
    sourcePath: selected.path,
    sourceContentHash: source.contentHash,
    sourceByteCount: source.byteCount,
    sourceDisposition,
    workstreamPath: CURRENT_WORKSTREAM_PATH,
    workstream,
    snapshotContentHash,
    operationId,
    approvalHash,
    referenceUpdates: references.updates,
    removedNormalizationRecords: normalizations.paths,
    candidates,
    blockers,
    operations,
  };
}

export async function applyContinuationWorkstreamMigrationPlan(input: {
  plan: ContinuationWorkstreamMigrationPlan;
  approvedOperationId: string;
  approvedHash: string;
  now: Date;
  recordApplied: (
    receipt: ContinuationWorkstreamMigrationReceipt,
    artifacts: { sourceContent: string; snapshotContent: string },
  ) => void | Promise<void>;
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<ContinuationWorkstreamMigrationReceipt> {
  if (
    input.plan.status !== "review_required" ||
    input.plan.workstream === null ||
    input.plan.sourcePath === null ||
    input.plan.sourceContentHash === null ||
    input.plan.snapshotContentHash === null ||
    input.plan.operationId === null ||
    input.plan.approvalHash === null
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The continuation workstream migration plan is not applicable.",
    );
  }
  if (
    !HASH.test(input.approvedHash) ||
    input.approvedOperationId !== input.plan.operationId ||
    input.approvedHash !== input.plan.approvalHash
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "Continuation migration requires the exact content-bound operation approval.",
    );
  }
  const current = await createContinuationWorkstreamMigrationPlan({
    repositoryRoot: input.plan.repositoryRoot,
    projectId: input.plan.projectId,
    sourcePath: input.plan.sourcePath,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  if (
    current.planId !== input.plan.planId ||
    current.workstream === null ||
    current.sourcePath === null ||
    current.sourceContentHash === null ||
    current.snapshotContentHash === null ||
    current.approvalHash === null
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The continuation source, a reference, normalization record, or current workstream changed after planning.",
    );
  }
  const snapshotContent = `${canonicalJson(current.workstream)}\n`;
  const source = await safeTextFile(current.repositoryRoot, current.sourcePath, MAX_HANDOFF_BYTES);
  if (source === null || source.contentHash !== current.sourceContentHash) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The continuation source changed after planning.",
    );
  }
  const previousState = await safeTextFile(
    current.repositoryRoot,
    CURRENT_WORKSTREAM_PATH,
    64 * 1024,
  );
  const receipt: ContinuationWorkstreamMigrationReceipt = {
    schemaVersion: 1,
    type: "workstream.snapshot.recorded",
    operation: "legacy_continuation_migration",
    planId: current.planId,
    projectId: current.projectId,
    workstreamId: current.workstream.workstreamId,
    revision: current.workstream.revision,
    status: current.workstream.status,
    sourceContentHash: current.sourceContentHash,
    snapshotContentHash: current.snapshotContentHash,
    previousSnapshotContentHash: previousState?.contentHash ?? null,
    approvalHash: current.approvalHash,
    referenceUpdatedCount: current.referenceUpdates.length,
    normalizationRecordRemovedCount: current.removedNormalizationRecords.length,
    sourceDisposition: current.sourceDisposition!,
    appliedAt: input.now.toISOString(),
  };
  return applyDurableKnowledgeOperations({
    repositoryRoot: current.repositoryRoot,
    projectId: current.projectId,
    planId: current.planId,
    operations: current.operations,
    documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
      repositoryRoot: current.repositoryRoot,
      operations: current.operations,
    }),
    receipt,
    recordApplied: (applied) =>
      input.recordApplied(applied, { sourceContent: source.content, snapshotContent }),
    ...(input.failureInjector === undefined ? {} : { failureInjector: input.failureInjector }),
  });
}

/** @deprecated Use the provider- and filename-neutral continuation migration contract. */
export type HandoffWorkstreamMigrationPlan = ContinuationWorkstreamMigrationPlan;
/** @deprecated Use the provider- and filename-neutral continuation migration contract. */
export type HandoffWorkstreamMigrationReceipt = ContinuationWorkstreamMigrationReceipt;
/** @deprecated Use createContinuationWorkstreamMigrationPlan. */
export const createHandoffWorkstreamMigrationPlan = createContinuationWorkstreamMigrationPlan;
/** @deprecated Use applyContinuationWorkstreamMigrationPlan. */
export const applyHandoffWorkstreamMigrationPlan = applyContinuationWorkstreamMigrationPlan;

export async function createWorkstreamUpdatePlan(input: {
  repositoryRoot: string;
  projectId: string;
  snapshot: unknown;
}): Promise<WorkstreamUpdatePlan> {
  const root = resolve(input.repositoryRoot);
  const blockers: WorkstreamUpdatePlan["blockers"] = [];
  const currentSource = await safeTextFile(root, CURRENT_WORKSTREAM_PATH, 64 * 1024);
  let current: WorkstreamSnapshot | null = null;
  try {
    current = await readCurrentWorkstream(root);
  } catch {
    blockers.push({
      code: "missing_current_workstream",
      message: "The current workstream is missing or invalid.",
    });
  }
  const desiredValidation = validateSchema("workstreamSnapshot", input.snapshot);
  const pendingValid =
    desiredValidation.valid && pendingCoordinatesValid(input.snapshot as WorkstreamSnapshot);
  const desiredValid = desiredValidation.valid && pendingValid;
  if (!desiredValid) {
    const details = desiredValidation.valid
      ? "pending decision or approval coordinates are inconsistent"
      : desiredValidation.errors
          .slice(0, 8)
          .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
          .join("; ");
    blockers.push({
      code: "invalid_snapshot",
      message: `The desired workstream does not satisfy the v1 contract: ${details}.`,
    });
  }
  const snapshot = desiredValid ? (input.snapshot as WorkstreamSnapshot) : null;
  if (current !== null && snapshot !== null) {
    if (snapshot.workstreamId !== current.workstreamId)
      blockers.push({
        code: "identity_changed",
        message: "A workstream update cannot change workstreamId.",
      });
    if (snapshot.revision !== current.revision + 1)
      blockers.push({
        code: "invalid_revision",
        message: "A workstream update must increment revision by exactly one.",
      });
    if (canonicalJson(snapshot.origin) !== canonicalJson(current.origin))
      blockers.push({
        code: "origin_changed",
        message: "A workstream update cannot rewrite origin evidence.",
      });
  }
  if (current === null && !blockers.some((item) => item.code === "missing_current_workstream")) {
    blockers.push({ code: "missing_current_workstream", message: "No current workstream exists." });
  }
  const snapshotContent = snapshot === null ? null : `${canonicalJson(snapshot)}\n`;
  const desiredSnapshotContentHash = snapshotContent === null ? null : sha256(snapshotContent);
  const planId = stableId("kwstreamplan", {
    projectId: input.projectId,
    currentSnapshotContentHash: currentSource?.contentHash ?? null,
    desiredIntentHash: snapshot === null ? null : workstreamIntentHash(snapshot),
    blockers,
  });
  const operations: KnowledgeFileOperation[] =
    blockers.length === 0 &&
    currentSource !== null &&
    snapshotContent !== null &&
    desiredSnapshotContentHash !== null
      ? [
          {
            path: CURRENT_WORKSTREAM_PATH,
            action: "update",
            ownership: "lervo_generated",
            mediaType: "application/json",
            content: snapshotContent,
            expectedCurrentHash: currentSource.contentHash,
            desiredHash: desiredSnapshotContentHash,
          },
        ]
      : [];
  return {
    schemaVersion: 1,
    planKind: "workstream_update",
    planId,
    status: blockers.length === 0 ? "ready" : "blocked",
    projectId: input.projectId,
    repositoryRoot: root,
    currentSnapshotContentHash: currentSource?.contentHash ?? null,
    desiredSnapshotContentHash,
    snapshot,
    blockers,
    operations,
  };
}

export async function applyWorkstreamUpdatePlan(input: {
  plan: WorkstreamUpdatePlan;
  now: Date;
  actor?: "user" | "agent";
  recordApplied: (
    receipt: WorkstreamUpdateReceipt,
    snapshotContent: string,
  ) => void | Promise<void>;
}): Promise<WorkstreamUpdateReceipt> {
  if (
    input.plan.status !== "ready" ||
    input.plan.snapshot === null ||
    input.plan.currentSnapshotContentHash === null ||
    input.plan.desiredSnapshotContentHash === null
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The workstream update plan is not applicable.",
    );
  }
  const current = await createWorkstreamUpdatePlan({
    repositoryRoot: input.plan.repositoryRoot,
    projectId: input.plan.projectId,
    snapshot: input.plan.snapshot,
  });
  if (
    current.planId !== input.plan.planId ||
    current.snapshot === null ||
    current.currentSnapshotContentHash === null ||
    current.desiredSnapshotContentHash === null
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The current or desired workstream changed after planning.",
    );
  }
  const snapshotContent = `${canonicalJson(current.snapshot)}\n`;
  const receipt: WorkstreamUpdateReceipt = {
    schemaVersion: 1,
    type: "workstream.snapshot.recorded",
    operation: input.actor === "agent" ? "agent_update" : "user_update",
    planId: current.planId,
    projectId: current.projectId,
    workstreamId: current.snapshot.workstreamId,
    revision: current.snapshot.revision,
    status: current.snapshot.status,
    snapshotContentHash: current.desiredSnapshotContentHash,
    previousSnapshotContentHash: current.currentSnapshotContentHash,
    appliedAt: input.now.toISOString(),
  };
  return applyDurableKnowledgeOperations({
    repositoryRoot: current.repositoryRoot,
    projectId: current.projectId,
    planId: current.planId,
    operations: current.operations,
    documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
      repositoryRoot: current.repositoryRoot,
      operations: current.operations,
    }),
    receipt,
    recordApplied: (applied) => input.recordApplied(applied, snapshotContent),
  });
}

export async function createReplicatedWorkstreamImportPlan(input: {
  repositoryRoot: string;
  projectId: string;
  snapshot: unknown;
  snapshotContentHash: string;
  previousSnapshotContentHash: string | null;
}): Promise<ReplicatedWorkstreamImportPlan> {
  const root = resolve(input.repositoryRoot);
  const blockers: ReplicatedWorkstreamImportPlan["blockers"] = [];
  const valid =
    HASH.test(input.snapshotContentHash) &&
    (input.previousSnapshotContentHash === null || HASH.test(input.previousSnapshotContentHash)) &&
    validateSchema("workstreamSnapshot", input.snapshot).valid &&
    pendingCoordinatesValid(input.snapshot as WorkstreamSnapshot);
  const snapshot = input.snapshot as WorkstreamSnapshot;
  const desiredContent = valid ? `${canonicalJson(snapshot)}\n` : "";
  if (!valid || sha256(desiredContent) !== input.snapshotContentHash) {
    blockers.push({
      code: "invalid_snapshot",
      message: "The replicated workstream bytes or hash are invalid.",
    });
  }
  const current = await readCurrentWorkstreamState(root);
  if (current !== null && valid && current.contentHash !== input.snapshotContentHash) {
    const successor = hasWorkstreamPredecessor(snapshot, {
      ...current.snapshot,
      snapshotContentHash: current.contentHash,
    });
    if (current.snapshot.workstreamId !== snapshot.workstreamId && !successor) {
      blockers.push({
        code: "identity_changed",
        message: "A replicated workstream cannot replace a different current workstream.",
      });
    }
    if (!successor && canonicalJson(current.snapshot.origin) !== canonicalJson(snapshot.origin)) {
      blockers.push({
        code: "origin_changed",
        message: "A replicated workstream cannot rewrite origin evidence.",
      });
    }
    if (!successor && snapshot.revision <= current.snapshot.revision) {
      blockers.push({
        code: "non_advancing_revision",
        message: "A replicated workstream must advance the local revision.",
      });
    }
  }
  const status =
    blockers.length > 0
      ? "blocked"
      : current?.contentHash === input.snapshotContentHash
        ? "current"
        : "ready";
  const operation: KnowledgeFileOperation = {
    path: CURRENT_WORKSTREAM_PATH,
    action: current === null ? "create" : "update",
    ownership: "lervo_generated",
    mediaType: "application/json",
    content: desiredContent,
    desiredHash: input.snapshotContentHash,
    ...(current === null ? {} : { expectedCurrentHash: current.contentHash }),
  };
  const planId = stableId("kwstreamrep", {
    projectId: input.projectId,
    currentSnapshotContentHash: current?.contentHash ?? null,
    desiredSnapshotContentHash: input.snapshotContentHash,
    previousSnapshotContentHash: input.previousSnapshotContentHash,
    blockers,
  });
  return {
    schemaVersion: 1,
    planKind: "replicated_workstream_import",
    planId,
    status,
    projectId: input.projectId,
    repositoryRoot: root,
    currentSnapshotContentHash: current?.contentHash ?? null,
    desiredSnapshotContentHash: input.snapshotContentHash,
    previousSnapshotContentHash: input.previousSnapshotContentHash,
    snapshot,
    blockers,
    operations: status === "ready" ? [operation] : [],
  };
}

export async function applyReplicatedWorkstreamImportPlan(input: {
  plan: ReplicatedWorkstreamImportPlan;
  now: Date;
  recordApplied: (
    receipt: ReplicatedWorkstreamImportReceipt,
    snapshotContent: string,
  ) => void | Promise<void>;
}): Promise<ReplicatedWorkstreamImportReceipt> {
  if (input.plan.status !== "ready") {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The replicated workstream import plan is not applicable.",
    );
  }
  const current = await createReplicatedWorkstreamImportPlan({
    repositoryRoot: input.plan.repositoryRoot,
    projectId: input.plan.projectId,
    snapshot: input.plan.snapshot,
    snapshotContentHash: input.plan.desiredSnapshotContentHash,
    previousSnapshotContentHash: input.plan.previousSnapshotContentHash,
  });
  if (current.planId !== input.plan.planId || current.status !== "ready") {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The local or replicated workstream changed after planning.",
    );
  }
  const content = `${canonicalJson(current.snapshot)}\n`;
  const receipt: ReplicatedWorkstreamImportReceipt = {
    schemaVersion: 1,
    type: "workstream.snapshot.recorded",
    operation: "hub_replication_import",
    planId: current.planId,
    projectId: current.projectId,
    workstreamId: current.snapshot.workstreamId,
    revision: current.snapshot.revision,
    status: current.snapshot.status,
    snapshotContentHash: current.desiredSnapshotContentHash,
    previousSnapshotContentHash: current.previousSnapshotContentHash,
    appliedAt: input.now.toISOString(),
  };
  return applyDurableKnowledgeOperations({
    repositoryRoot: current.repositoryRoot,
    projectId: current.projectId,
    planId: current.planId,
    operations: current.operations,
    documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
      repositoryRoot: current.repositoryRoot,
      operations: current.operations,
    }),
    receipt,
    recordApplied: (applied) => input.recordApplied(applied, content),
  });
}
