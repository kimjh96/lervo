import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { canonicalJson } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

const TRANSACTION_RELATIVE = ".lervo/state/knowledge/materialization-transaction";
export const JOURNAL_NAME = "journal.json";

export interface JournalOperation {
  path: string;
  action: "create" | "update" | "delete" | "move" | "move_update";
  destinationPath?: string;
  beforeHash: string | null;
  afterHash: string | null;
}

export interface KnowledgeMaterializationJournal {
  schemaVersion: 1;
  transactionType: "knowledge_materialization";
  planId: string;
  projectId: string;
  ownerPid: number;
  phase: "preparing" | "staged" | "publishing" | "event_recording" | "committed";
  publishedCount: number;
  activeIndex: number | null;
  operations: JournalOperation[];
}

export function transactionRoot(root: string): string {
  return resolve(root, TRANSACTION_RELATIVE);
}

export function safeTarget(root: string, path: string): string {
  const target = resolve(root, path);
  const child = relative(root, target);
  if (child === ".." || child.startsWith(`..${sep}`))
    throw new RepositoryKnowledgeError(
      "knowledge_recovery_invalid",
      "The knowledge transaction path escapes the repository.",
    );
  return target;
}

function validJournal(value: unknown): value is KnowledgeMaterializationJournal {
  const item = value as KnowledgeMaterializationJournal | null;
  return (
    item !== null &&
    typeof item === "object" &&
    item.schemaVersion === 1 &&
    item.transactionType === "knowledge_materialization" &&
    /^(?:ksmat|kstruct|ktermplan|kbridgeplan|kinstbootplan|kinstructionplan|klayout|knormplan|kwstreamplan|kpatternplan)_[a-f0-9]{24}$/.test(
      item.planId,
    ) &&
    typeof item.projectId === "string" &&
    Number.isSafeInteger(item.ownerPid) &&
    item.ownerPid > 0 &&
    ["preparing", "staged", "publishing", "event_recording", "committed"].includes(item.phase) &&
    Number.isSafeInteger(item.publishedCount) &&
    item.publishedCount >= 0 &&
    (item.activeIndex === null ||
      (Number.isSafeInteger(item.activeIndex) && item.activeIndex >= 0)) &&
    Array.isArray(item.operations) &&
    item.operations.length > 0 &&
    item.operations.length <= 20000 &&
    new Set(
      item.operations.flatMap((operation) => [
        operation.path,
        ...(operation.destinationPath === undefined ? [] : [operation.destinationPath]),
      ]),
    ).size ===
      item.operations.reduce(
        (count, operation) => count + (operation.destinationPath === undefined ? 1 : 2),
        0,
      ) &&
    item.operations.every(
      (operation) =>
        typeof operation.path === "string" &&
        (operation.action === "create" ||
          operation.action === "update" ||
          operation.action === "delete" ||
          operation.action === "move" ||
          operation.action === "move_update") &&
        (operation.beforeHash === null || /^sha256:[a-f0-9]{64}$/.test(operation.beforeHash)) &&
        (operation.afterHash === null || /^sha256:[a-f0-9]{64}$/.test(operation.afterHash)) &&
        (operation.action === "delete"
          ? operation.destinationPath === undefined &&
            operation.beforeHash !== null &&
            operation.afterHash === null
          : operation.action === "move" || operation.action === "move_update"
            ? typeof operation.destinationPath === "string" &&
              operation.destinationPath !== operation.path &&
              operation.beforeHash !== null &&
              operation.afterHash !== null &&
              (operation.action === "move_update" || operation.afterHash === operation.beforeHash)
            : operation.destinationPath === undefined && operation.afterHash !== null),
    )
  );
}

export async function readJournal(root: string): Promise<KnowledgeMaterializationJournal> {
  const transaction = transactionRoot(root);
  try {
    const stat = await lstat(transaction);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe transaction");
    const names = await readdir(transaction);
    if (!names.includes(JOURNAL_NAME)) throw new Error("missing journal");
    const bytes = await readFile(resolve(transaction, JOURNAL_NAME));
    if (bytes.byteLength > 4 * 1024 * 1024) throw new Error("large journal");
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!validJournal(value) || `${canonicalJson(value)}\n` !== bytes.toString("utf8"))
      throw new Error("invalid journal");
    for (const operation of value.operations) {
      safeTarget(root, operation.path);
      if (operation.destinationPath !== undefined) safeTarget(root, operation.destinationPath);
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new RepositoryKnowledgeError(
        "knowledge_recovery_not_found",
        "No knowledge materialization transaction is available to recover.",
        undefined,
        { cause: error },
      );
    if (error instanceof RepositoryKnowledgeError) throw error;
    throw new RepositoryKnowledgeError(
      "knowledge_recovery_invalid",
      "The knowledge materialization transaction journal is invalid.",
      undefined,
      { cause: error },
    );
  }
}
