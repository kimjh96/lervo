import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  applyDurableKnowledgeOperations,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { planDurableInstructionReplacements } from "./durable-instruction-replacement.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import type { KnowledgeFileOperation } from "./types.js";

export interface GroundedDurableInstruction {
  disposition: "none" | "workstream" | "canonical" | "pending";
  speechAct:
    "directive" | "example" | "quotation" | "hypothetical" | "complaint" | "question" | "other";
  authority: "explicit_user" | "inferred";
  durability: "turn" | "workstream" | "repository" | "unspecified";
  operation: "none" | "add" | "replace" | "remove";
  scope: { kind: "repository" | "paths" | "unspecified"; paths: string[] };
  title: string | null;
  statement: string | null;
  exceptions: string[];
  risk: "low" | "high" | "unknown";
  conflict: "none" | "covered" | "possible" | "unknown";
  confidence: "high" | "medium" | "low";
  reasonIds: string[];
  /** Catalog paths of older rules this rule supersedes in the same scope (ADR-0561). */
  replaces?: string[];
}

/**
 * ADR-0561 plan states. `ungrounded`: the rule text is not available yet, so the caller retries
 * grounding in the background; nothing is dropped. `ready` stores the rule and deletes any older
 * generated rule it replaces; `current` means the same rule is already stored.
 */
export interface DurableInstructionPlan {
  schemaVersion: 1;
  planKind: "durable_instruction_intake";
  planId: string;
  status: "ignored" | "workstream" | "ungrounded" | "current" | "ready";
  repositoryRoot: string;
  projectId: string;
  requestDigest: string;
  resolverResultDigest: string;
  ruleId: string | null;
  targetPath: string | null;
  /** Generated rule paths the plan deletes because this rule replaces them. */
  replacedPaths: string[];
  reasonIds: string[];
  operations: KnowledgeFileOperation[];
}

const HASH = /^sha256:[a-f0-9]{64}$/u;

function markdownText(value: string, field: string, maximumBytes: number): string {
  if (
    value.trim() !== value ||
    value.length === 0 ||
    Buffer.byteLength(value) > maximumBytes ||
    (field === "title" && /[\r\n]/u.test(value))
  )
    throw new TypeError(`The durable instruction ${field} is invalid.`);
  return value;
}

function safePaths(paths: string[]): string[] {
  if (
    paths.length > 16 ||
    paths.some(
      (path) =>
        path.length === 0 ||
        path.length > 500 ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").some((part) => part === "" || part === "." || part === ".."),
    )
  )
    throw new TypeError("The durable instruction contains an unsafe scope path.");
  return [...new Set(paths)].sort();
}

/** Unspecified scope means repository-wide (ADR-0561). */
function effectiveScope(scope: GroundedDurableInstruction["scope"]): {
  kind: "repository" | "paths";
  paths: string[];
} {
  const paths = safePaths(scope.kind === "paths" ? scope.paths : []);
  return paths.length === 0 ? { kind: "repository", paths: [] } : { kind: "paths", paths };
}

function renderedInstruction(input: {
  ruleId: string;
  instruction: GroundedDurableInstruction & { title: string; statement: string };
  scopePaths: string[];
  replacedRuleIds: string[];
}): string {
  const classification = [...new Set(input.instruction.reasonIds)].sort();
  const frontmatter = [
    "---",
    ...(input.scopePaths.length === 0
      ? []
      : ["paths:", ...input.scopePaths.map((path) => `  - ${JSON.stringify(path)}`)]),
    "lervo:",
    "  durableInstruction:",
    "    schemaVersion: 1",
    `    ruleId: ${input.ruleId}`,
    `    authority: ${input.instruction.authority}`,
    `    operation: ${input.instruction.operation}`,
    `    risk: ${input.instruction.risk}`,
    ...(classification.length === 0
      ? []
      : ["    classification:", ...classification.map((reason) => `      - ${reason}`)]),
    ...(input.replacedRuleIds.length === 0
      ? []
      : ["    replaces:", ...input.replacedRuleIds.map((ruleId) => `      - ${ruleId}`)]),
    "---",
  ];
  const exceptions =
    input.instruction.exceptions.length === 0
      ? []
      : [
          "",
          "## Exceptions",
          "",
          ...input.instruction.exceptions.map((exception) => `- ${exception}`),
        ];
  return [
    ...frontmatter,
    `# ${input.instruction.title}`,
    "",
    input.instruction.statement,
    ...exceptions,
    "",
  ].join("\n");
}

async function existingContent(repositoryRoot: string, path: string): Promise<string | null> {
  try {
    return await readFile(resolve(repositoryRoot, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function ruleOperation(input: {
  targetPath: string;
  content: string;
  current: string | null;
}): KnowledgeFileOperation {
  const desiredHash = sha256(input.content);
  const base = {
    path: input.targetPath,
    ownership: "lervo_generated" as const,
    mediaType: "text/markdown" as const,
    desiredHash,
  };
  if (input.current === null)
    return { ...base, action: "create", content: input.content, reason: "owner_rule_stored" };
  if (sha256(input.current) === desiredHash)
    return {
      ...base,
      action: "unchanged",
      content: input.content,
      expectedCurrentHash: desiredHash,
      reason: "owner_rule_already_current",
    };
  return {
    ...base,
    action: "update",
    content: input.content,
    expectedCurrentHash: sha256(input.current),
    reason: "owner_rule_reclassified",
  };
}

/**
 * ADR-0561: an owner rule with grounded text is always planned for storage, whatever its risk,
 * operation, conflict, confidence, or scope; those are recorded as its classification. The only
 * non-storing outcomes are a statement that is no rule (`ignored`, `workstream`) and a rule whose
 * text is not grounded yet (`ungrounded`), which the caller retries.
 */
export async function createDurableInstructionPlan(input: {
  repositoryRoot: string;
  projectId: string;
  requestDigest: string;
  resolverResultDigest: string;
  instruction: GroundedDurableInstruction;
}): Promise<DurableInstructionPlan> {
  if (!HASH.test(input.requestDigest) || !HASH.test(input.resolverResultDigest))
    throw new TypeError("Durable instruction evidence digests are invalid.");
  const reasonIds = [...new Set(input.instruction.reasonIds)].sort();
  const base = {
    schemaVersion: 1 as const,
    planKind: "durable_instruction_intake" as const,
    repositoryRoot: resolve(input.repositoryRoot),
    projectId: input.projectId,
    requestDigest: input.requestDigest,
    resolverResultDigest: input.resolverResultDigest,
  };
  const empty = (status: DurableInstructionPlan["status"], reasons: string[]) => ({
    ...base,
    planId: stableId("kinstructionplan", {
      projectId: input.projectId,
      requestDigest: input.requestDigest,
      status,
      reasons,
    }),
    status,
    ruleId: null,
    targetPath: null,
    replacedPaths: [],
    reasonIds: reasons,
    operations: [],
  });
  if (input.instruction.disposition === "none") return empty("ignored", reasonIds);
  if (input.instruction.disposition === "workstream") return empty("workstream", reasonIds);
  if (input.instruction.title === null || input.instruction.statement === null)
    return empty("ungrounded", [...reasonIds, "rule_text_unavailable"]);
  const title = markdownText(input.instruction.title, "title", 160);
  const statement = markdownText(input.instruction.statement, "statement", 2_000);
  input.instruction.exceptions.forEach((item) => markdownText(item, "exception", 512));
  const scope = effectiveScope(input.instruction.scope);
  const identity = {
    title,
    statement,
    scope,
    exceptions: input.instruction.exceptions,
  };
  const ruleId = stableId("rule", identity);
  const targetPath = `docs/instructions/generated/${ruleId}.md`;
  const replacements = await planDurableInstructionReplacements({
    repositoryRoot: base.repositoryRoot,
    replaces: input.instruction.replaces ?? [],
    scopePaths: scope.paths,
    targetPath,
  });
  const replacedPaths = replacements.operations.map((operation) => operation.path);
  const content = renderedInstruction({
    ruleId,
    instruction: { ...input.instruction, title, statement },
    scopePaths: scope.paths,
    replacedRuleIds: replacedPaths.map((path) => path.slice(path.lastIndexOf("/") + 1, -3)),
  });
  const rule = ruleOperation({
    targetPath,
    content,
    current: await existingContent(base.repositoryRoot, targetPath),
  });
  const status = rule.action === "unchanged" && replacedPaths.length === 0 ? "current" : "ready";
  const operations = [rule, ...replacements.operations];
  const planId = stableId("kinstructionplan", {
    projectId: input.projectId,
    requestDigest: input.requestDigest,
    resolverResultDigest: input.resolverResultDigest,
    ruleId,
    targetPath,
    desiredHash: rule.desiredHash,
    replacedPaths,
    status,
  });
  return {
    ...base,
    planId,
    status,
    ruleId,
    targetPath,
    replacedPaths,
    reasonIds: [...new Set([...reasonIds, ...replacements.skippedReasonIds])].sort(),
    operations,
  };
}

export async function applyDurableInstructionPlan<T>(input: {
  plan: DurableInstructionPlan;
  receipt: T;
  recordApplied: (receipt: T) => void | Promise<void>;
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<T> {
  if (input.plan.status !== "ready")
    throw new Error("The durable instruction plan is not applicable.");
  return applyDurableKnowledgeOperations({
    repositoryRoot: input.plan.repositoryRoot,
    projectId: input.plan.projectId,
    planId: input.plan.planId,
    operations: input.plan.operations,
    documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
      repositoryRoot: input.plan.repositoryRoot,
      operations: input.plan.operations,
    }),
    receipt: input.receipt,
    recordApplied: input.recordApplied,
    ...(input.failureInjector === undefined ? {} : { failureInjector: input.failureInjector }),
  });
}

export function durableInstructionCatalogEntry(input: { path: string; content: string }): {
  path: string;
  contentHash: string;
  excerpt: string;
} {
  const excerptBytes = Buffer.from(input.content);
  let excerpt = input.content;
  if (excerptBytes.byteLength > 2_048) {
    let end = 2_048;
    while (end > 0 && ((excerptBytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
    excerpt = excerptBytes.subarray(0, end).toString("utf8");
  }
  return {
    path: input.path,
    contentHash: sha256(input.content),
    excerpt,
  };
}

export function durableInstructionRecordDigest(plan: DurableInstructionPlan): string {
  return sha256(
    canonicalJson({
      ruleId: plan.ruleId,
      targetPath: plan.targetPath,
      requestDigest: plan.requestDigest,
      resolverResultDigest: plan.resolverResultDigest,
    }),
  );
}
