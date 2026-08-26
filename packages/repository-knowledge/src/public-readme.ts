import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { loadProjectManifest } from "@lervo/project";

import {
  applyDurableKnowledgeOperations,
  type DurableKnowledgeUserFileOperation,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { RepositoryKnowledgeError, type KnowledgeFileOperation } from "./types.js";

export type PublicReadmeCoordinateKind =
  | "html_block"
  | "image"
  | "badge"
  | "link_target"
  | "anchor"
  | "fenced_command"
  | "package_name"
  | "installation_command"
  | "version_requirement"
  | "license_link"
  | "security_link"
  | "sponsor_link"
  | "table"
  | "accessibility_text";

export interface PublicReadmeCoordinate {
  coordinateId: string;
  kind: PublicReadmeCoordinateKind;
  value: string;
  valueHash: string;
}

export interface PublicReadmeCoordinateChange {
  changeId: string;
  kind: PublicReadmeCoordinateKind;
  disposition: "added" | "removed";
  value: string;
  valueHash: string;
}

export interface PublicReadmeImprovementPlan {
  schemaVersion: 1;
  planKind: "public_readme_improvement";
  planId: string;
  operationId: string;
  approvalHash: string;
  status: "review_required" | "current";
  projectId: string;
  repositoryRoot: string;
  path: "README.md";
  sourceHash: string | null;
  candidateHash: string;
  audience: string;
  intent: string;
  profileId: "public_readme_en_v1";
  language: "en";
  coordinateCoverage: {
    sourceCount: number;
    candidateCount: number;
    changedCount: number;
    complete: true;
  };
  coordinateChanges: PublicReadmeCoordinateChange[];
  operations: Array<DurableKnowledgeUserFileOperation | KnowledgeFileOperation>;
}

export interface PublicReadmeImprovementReceipt {
  schemaVersion: 1;
  operation: "public_readme_improvement";
  planId: string;
  operationId: string;
  projectId: string;
  sourceHash: string | null;
  outputHash: string;
  profileId: "public_readme_en_v1";
  language: "en";
  audienceDigest: string;
  intentDigest: string;
  protectedCoordinateDigest: string;
  protectedCoordinateCount: number;
  changedCoordinateCount: number;
  approvalHash: string;
  appliedAt: string;
}

const MAXIMUM_README_BYTES = 256 * 1024;

async function safeReadme(root: string): Promise<{ content: string; hash: string } | null> {
  const path = resolve(root, "README.md");
  let handle;
  try {
    let readablePath = path;
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        const [canonicalRoot, target] = await Promise.all([realpath(root), realpath(path)]);
        const fromRoot = relative(canonicalRoot, target);
        if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) throw new Error("unsafe");
        readablePath = target;
      } else if (!info.isFile()) throw new Error("unsafe");
      const targetInfo = await lstat(readablePath);
      if (
        !targetInfo.isFile() ||
        targetInfo.isSymbolicLink() ||
        targetInfo.size > MAXIMUM_README_BYTES
      )
        throw new Error("unsafe");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    handle = await open(readablePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const bytes = await handle.readFile();
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      hash: sha256(bytes),
    };
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The public README cannot be read safely.",
    );
  } finally {
    await handle?.close();
  }
}

function push(
  values: Array<{ kind: PublicReadmeCoordinateKind; value: string }>,
  kind: PublicReadmeCoordinateKind,
  value: string,
): void {
  const normalized = value.trim();
  if (normalized.length > 0) values.push({ kind, value: normalized });
}

export function extractPublicReadmeCoordinates(content: string): PublicReadmeCoordinate[] {
  const values: Array<{ kind: PublicReadmeCoordinateKind; value: string }> = [];
  for (const match of content.matchAll(
    /<(?:div|p|table|picture|details|summary|a)\b[\s\S]*?<\/(?:div|p|table|picture|details|summary|a)>/giu,
  ))
    push(values, "html_block", match[0]);
  for (const match of content.matchAll(/<img\b[^>]*>/giu)) {
    const tag = match[0];
    const source = /\bsrc=["']([^"']+)["']/iu.exec(tag)?.[1] ?? "";
    const alternative = /\balt=["']([^"']*)["']/iu.exec(tag)?.[1] ?? "";
    push(
      values,
      /badge/iu.test(source) || /badge/iu.test(alternative) ? "badge" : "image",
      `${alternative}\u0000${source}`,
    );
    push(values, "accessibility_text", alternative);
  }
  for (const match of content.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
    push(
      values,
      /badge/iu.test(match[1] ?? "") || /badge/iu.test(match[2] ?? "") ? "badge" : "image",
      `${match[1] ?? ""}\u0000${match[2] ?? ""}`,
    );
    push(values, "accessibility_text", match[1] ?? "");
  }
  for (const match of content.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
    const label = match[1] ?? "";
    const target = match[2] ?? "";
    const lower = label.toLocaleLowerCase();
    push(
      values,
      lower.includes("license")
        ? "license_link"
        : lower.includes("security")
          ? "security_link"
          : /sponsor|fund/iu.test(lower)
            ? "sponsor_link"
            : "link_target",
      `${label}\u0000${target}`,
    );
  }
  for (const match of content.matchAll(/<(?:a\s+(?:id|name)|[^>]+\sid)=["']([^"']+)["'][^>]*>/giu))
    push(values, "anchor", match[1] ?? "");
  for (const match of content.matchAll(/```(?:bash|sh|shell|zsh|console)?\n([\s\S]*?)```/gu))
    push(values, "fenced_command", match[1] ?? "");
  for (const line of content.split("\n")) {
    if (/^\s*(?:npm|pnpm|yarn|bun|pipx?|cargo|go)\s+(?:install|add|get)\b/u.test(line))
      push(values, "installation_command", line);
    if (
      /\b(?:Node(?:\.js)?|Python|Go|Rust|Java)\s+(?:v?\d|version)|\brequires?\s+[^\n]*\d/u.test(
        line,
      )
    )
      push(values, "version_requirement", line);
    if (/^\s*\|.*\|\s*$/u.test(line)) push(values, "table", line);
  }
  for (const match of content.matchAll(
    /(?<![\w@/.-])(?:@[a-z0-9_.-]+\/[a-z0-9_.-]+|[a-z0-9_.-]+\/[a-z0-9_.-]+)(?![\w/.-])/giu,
  ))
    push(values, "package_name", match[0]);
  const unique = [
    ...new Map(values.map((value) => [`${value.kind}\u0000${value.value}`, value])).values(),
  ].sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value),
  );
  return unique.map((value) => ({
    ...value,
    valueHash: sha256(value.value),
    coordinateId: stableId("prc", value),
  }));
}

function validateCandidate(content: string, existing: boolean): void {
  const bytes = Buffer.byteLength(content);
  const hasPrimaryHeading =
    /^#\s+\S/mu.test(content) || /<h1(?:\s[^>]*)?>[\s\S]*?\S[\s\S]*?<\/h1>/iu.test(content);
  if (
    bytes < 1 ||
    bytes > MAXIMUM_README_BYTES ||
    !content.endsWith("\n") ||
    content.endsWith("\n\n") ||
    !hasPrimaryHeading
  )
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "The public README candidate violates its bounded Markdown contract.",
    );
  if (
    /(?:\.lervo\/|\bAGENTS\.md\b|\blervo\s+terminal\b|provider hook|workstream checkpoint)/iu.test(
      content,
    )
  )
    throw new RepositoryKnowledgeError(
      "knowledge_compile_policy_violation",
      "A public README candidate exposes internal agent operation or bookkeeping.",
    );
  if (
    !existing &&
    /(?:https?:\/\/|!\[|\b(?:npm|pnpm|yarn|bun)\s+(?:install|add)\b|@[a-z0-9_.-]+\/)/iu.test(
      content,
    )
  )
    throw new RepositoryKnowledgeError(
      "knowledge_compile_policy_violation",
      "A missing public README candidate cannot invent external, badge, or package coordinates.",
    );
}

function coordinateChanges(
  source: PublicReadmeCoordinate[],
  candidate: PublicReadmeCoordinate[],
): PublicReadmeCoordinateChange[] {
  const sourceKeys = new Set(source.map((item) => `${item.kind}\u0000${item.value}`));
  const candidateKeys = new Set(candidate.map((item) => `${item.kind}\u0000${item.value}`));
  return [
    ...source
      .filter((item) => !candidateKeys.has(`${item.kind}\u0000${item.value}`))
      .map((item) => ({
        kind: item.kind,
        disposition: "removed" as const,
        value: item.value,
        valueHash: item.valueHash,
      })),
    ...candidate
      .filter((item) => !sourceKeys.has(`${item.kind}\u0000${item.value}`))
      .map((item) => ({
        kind: item.kind,
        disposition: "added" as const,
        value: item.value,
        valueHash: item.valueHash,
      })),
  ]
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.disposition.localeCompare(right.disposition) ||
        left.value.localeCompare(right.value),
    )
    .map((item) => ({ ...item, changeId: stableId("prchg", item) }));
}

export async function createPublicReadmeImprovementPlan(input: {
  repositoryRoot: string;
  candidateContent: string;
  audience: string;
  intent: string;
}): Promise<PublicReadmeImprovementPlan> {
  const root = resolve(input.repositoryRoot);
  const project = await loadProjectManifest(root);
  const source = await safeReadme(root);
  if (
    input.audience.trim().length < 1 ||
    input.audience.length > 500 ||
    input.intent.trim().length < 1 ||
    input.intent.length > 1_000
  )
    throw new RepositoryKnowledgeError(
      "knowledge_compile_policy_violation",
      "The public README audience or intent contract is invalid.",
    );
  validateCandidate(input.candidateContent, source !== null);
  const candidateHash = sha256(input.candidateContent);
  const sourceCoordinates = extractPublicReadmeCoordinates(source?.content ?? "");
  const candidateCoordinates = extractPublicReadmeCoordinates(input.candidateContent);
  const changes = coordinateChanges(sourceCoordinates, candidateCoordinates);
  const operationId = stableId("prdop", {
    projectId: project.projectId,
    sourceHash: source?.hash ?? null,
    candidateHash,
    audience: input.audience,
    intent: input.intent,
    changes,
  });
  const approvalHash = sha256(
    canonicalJson({ operationId, sourceHash: source?.hash ?? null, candidateHash, changes }),
  );
  const status =
    source?.hash === candidateHash ? ("current" as const) : ("review_required" as const);
  const record = {
    schemaVersion: 1,
    kind: "lervo_public_readme_review",
    operationId,
    sourceHash: source?.hash ?? null,
    outputHash: candidateHash,
    profileId: "public_readme_en_v1",
    language: "en",
    audienceDigest: sha256(input.audience),
    intentDigest: sha256(input.intent),
    protectedCoordinateDigest: sha256(
      canonicalJson(
        candidateCoordinates.map(({ coordinateId, kind, valueHash }) => ({
          coordinateId,
          kind,
          valueHash,
        })),
      ),
    ),
    protectedCoordinateCount: candidateCoordinates.length,
    changedCoordinateCount: changes.length,
    approvalHash,
  };
  const recordPath = `.lervo/state/public-readme/${operationId}.json`;
  const operations: Array<DurableKnowledgeUserFileOperation | KnowledgeFileOperation> =
    status === "current"
      ? []
      : [
          {
            path: "README.md",
            action: source === null ? "create" : "update",
            ownership: "user",
            mediaType: "text/markdown",
            content: input.candidateContent,
            ...(source === null ? {} : { expectedCurrentHash: source.hash }),
            desiredHash: candidateHash,
          },
          {
            path: recordPath,
            action: "create",
            ownership: "lervo_generated",
            mediaType: "application/json",
            content: `${JSON.stringify(record, null, 2)}\n`,
            desiredHash: sha256(`${JSON.stringify(record, null, 2)}\n`),
          },
        ];
  const body = {
    schemaVersion: 1 as const,
    planKind: "public_readme_improvement" as const,
    operationId,
    approvalHash,
    status,
    projectId: project.projectId,
    repositoryRoot: root,
    path: "README.md" as const,
    sourceHash: source?.hash ?? null,
    candidateHash,
    audience: input.audience,
    intent: input.intent,
    profileId: "public_readme_en_v1" as const,
    language: "en" as const,
    coordinateCoverage: {
      sourceCount: sourceCoordinates.length,
      candidateCount: candidateCoordinates.length,
      changedCount: changes.length,
      complete: true as const,
    },
    coordinateChanges: changes,
    operations,
  };
  await authorizeCurrentRepositoryDocumentLayout({ repositoryRoot: root, operations });
  return { ...body, planId: stableId("prdplan", body) };
}

export async function applyPublicReadmeImprovementPlan(input: {
  plan: PublicReadmeImprovementPlan;
  candidateContent: string;
  approvedOperationId: string;
  approvedHash: string;
  approvedCoordinateChangeIds: string[];
  now: Date;
  recordApplied: (receipt: PublicReadmeImprovementReceipt) => void | Promise<void>;
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<PublicReadmeImprovementReceipt> {
  if (
    input.plan.status !== "review_required" ||
    input.approvedOperationId !== input.plan.operationId ||
    input.approvedHash !== input.plan.approvalHash
  )
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "The public README improvement requires its exact content-bound approval.",
    );
  const required = input.plan.coordinateChanges.map((item) => item.changeId).sort();
  const approved = [...new Set(input.approvedCoordinateChangeIds)].sort();
  if (JSON.stringify(required) !== JSON.stringify(approved))
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "Every changed public coordinate requires an individually visible disposition approval.",
    );
  const current = await createPublicReadmeImprovementPlan({
    repositoryRoot: input.plan.repositoryRoot,
    candidateContent: input.candidateContent,
    audience: input.plan.audience,
    intent: input.plan.intent,
  });
  if (current.planId !== input.plan.planId)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The public README or proposal contract changed after review.",
    );
  const coordinates = extractPublicReadmeCoordinates(input.candidateContent);
  const receipt: PublicReadmeImprovementReceipt = {
    schemaVersion: 1,
    operation: "public_readme_improvement",
    planId: current.planId,
    operationId: current.operationId,
    projectId: current.projectId,
    sourceHash: current.sourceHash,
    outputHash: current.candidateHash,
    profileId: current.profileId,
    language: current.language,
    audienceDigest: sha256(current.audience),
    intentDigest: sha256(current.intent),
    protectedCoordinateDigest: sha256(
      canonicalJson(
        coordinates.map(({ coordinateId, kind, valueHash }) => ({ coordinateId, kind, valueHash })),
      ),
    ),
    protectedCoordinateCount: coordinates.length,
    changedCoordinateCount: current.coordinateChanges.length,
    approvalHash: current.approvalHash,
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
    recordApplied: input.recordApplied,
    ...(input.failureInjector === undefined ? {} : { failureInjector: input.failureInjector }),
  });
}
