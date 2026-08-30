import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { applyDurableKnowledgeOperations } from "./durable-apply.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
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
}

export interface DurableInstructionPlan {
  schemaVersion: 1;
  planKind: "durable_instruction_intake";
  planId: string;
  status: "ignored" | "workstream" | "current" | "pending" | "ready" | "blocked";
  repositoryRoot: string;
  projectId: string;
  requestDigest: string;
  resolverResultDigest: string;
  ruleId: string | null;
  targetPath: string | null;
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

function renderedInstruction(input: {
  ruleId: string;
  instruction: GroundedDurableInstruction & { title: string; statement: string };
}): string {
  const paths = safePaths(input.instruction.scope.paths);
  const frontmatter = [
    "---",
    ...(paths.length === 0
      ? []
      : ["paths:", ...paths.map((path) => `  - ${JSON.stringify(path)}`)]),
    "lervo:",
    "  durableInstruction:",
    "    schemaVersion: 1",
    `    ruleId: ${input.ruleId}`,
    "    authority: explicit_user",
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

export async function createDurableInstructionPlan(input: {
  repositoryRoot: string;
  projectId: string;
  requestDigest: string;
  resolverResultDigest: string;
  groundingStatus: "ready" | "clarify" | "abstain" | "approval_required";
  catalogComplete: boolean;
  ambiguityReasons: string[];
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
    reasonIds: reasons,
    operations: [],
  });
  if (input.instruction.disposition === "none") return empty("ignored", reasonIds);
  if (input.instruction.disposition === "workstream") return empty("workstream", reasonIds);
  if (
    input.instruction.disposition !== "canonical" ||
    input.groundingStatus !== "ready" ||
    !input.catalogComplete ||
    input.ambiguityReasons.length > 0 ||
    input.instruction.speechAct !== "directive" ||
    input.instruction.authority !== "explicit_user" ||
    input.instruction.durability !== "repository" ||
    input.instruction.operation !== "add" ||
    input.instruction.scope.kind === "unspecified" ||
    input.instruction.title === null ||
    input.instruction.statement === null ||
    input.instruction.risk !== "low" ||
    input.instruction.conflict !== "none" ||
    input.instruction.confidence !== "high"
  )
    return empty("pending", [...reasonIds, "automatic_gate_not_satisfied"]);
  const title = markdownText(input.instruction.title, "title", 160);
  const statement = markdownText(input.instruction.statement, "statement", 2_000);
  input.instruction.exceptions.forEach((item) => markdownText(item, "exception", 512));
  const identity = {
    title,
    statement,
    scope: { kind: input.instruction.scope.kind, paths: safePaths(input.instruction.scope.paths) },
    exceptions: input.instruction.exceptions,
  };
  const ruleId = stableId("rule", identity);
  const targetPath = `docs/instructions/generated/${ruleId}.md`;
  const content = renderedInstruction({
    ruleId,
    instruction: { ...input.instruction, title, statement, scope: identity.scope },
  });
  const desiredHash = sha256(content);
  const current = await existingContent(base.repositoryRoot, targetPath);
  const status =
    current === null ? "ready" : sha256(current) === desiredHash ? "current" : "blocked";
  const operations: KnowledgeFileOperation[] =
    status === "ready"
      ? [
          {
            path: targetPath,
            action: "create",
            ownership: "lervo_generated",
            mediaType: "text/markdown",
            content,
            desiredHash,
            reason: "explicit_user_durable_instruction",
          },
        ]
      : status === "current"
        ? [
            {
              path: targetPath,
              action: "unchanged",
              ownership: "lervo_generated",
              mediaType: "text/markdown",
              expectedCurrentHash: desiredHash,
              desiredHash,
              reason: "explicit_user_durable_instruction_already_current",
            },
          ]
        : [];
  const planId = stableId("kinstructionplan", {
    projectId: input.projectId,
    requestDigest: input.requestDigest,
    resolverResultDigest: input.resolverResultDigest,
    ruleId,
    targetPath,
    desiredHash,
    status,
  });
  return {
    ...base,
    planId,
    status,
    ruleId,
    targetPath,
    reasonIds: status === "blocked" ? [...reasonIds, "target_conflict"] : reasonIds,
    operations,
  };
}

export async function applyDurableInstructionPlan<T>(input: {
  plan: DurableInstructionPlan;
  receipt: T;
  recordApplied: (receipt: T) => void | Promise<void>;
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
