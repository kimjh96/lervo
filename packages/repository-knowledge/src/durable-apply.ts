import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { validateDocumentLayoutPermit, type DocumentLayoutPermit } from "@lervo/documents";
import { syncDirectory } from "@lervo/filesystem-durability";

import { evaluateCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { canonicalJson, sha256 } from "./integrity.js";
import { withKnowledgeSourceWrite } from "./knowledge-source-gate.js";
import type { KnowledgeFileOperation } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

const TRANSACTION_RELATIVE = ".lervo/state/knowledge/materialization-transaction";
const JOURNAL_NAME = "journal.json";

export type KnowledgeMaterializationCheckpoint =
  "staged" | `original_moved:${number}` | `published:${number}` | "event_recorded" | "committed";

interface JournalOperation {
  path: string;
  action: "create" | "update" | "delete" | "move" | "move_update";
  destinationPath?: string;
  beforeHash: string | null;
  afterHash: string | null;
}

export interface DurableKnowledgeDeleteOperation {
  path: string;
  action: "delete";
  expectedCurrentHash: string;
}

export interface DurableKnowledgeMoveOperation {
  path: string;
  destinationPath: string;
  action: "move";
  expectedCurrentHash: string;
}

export interface DurableKnowledgeMoveUpdateOperation {
  path: string;
  destinationPath: string;
  action: "move_update";
  ownership: "user";
  mediaType: "text/markdown";
  expectedCurrentHash: string;
  desiredHash: string;
  content: string;
}

export interface DurableKnowledgeUserFileOperation {
  path: string;
  action: "create" | "update";
  ownership: "user";
  mediaType:
    | "text/markdown"
    | "text/plain"
    | "application/json"
    | "application/yaml"
    | "text/javascript"
    | "text/typescript";
  content: string;
  expectedCurrentHash?: string;
  desiredHash: string;
}

interface KnowledgeMaterializationJournal {
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

function transactionRoot(root: string): string {
  return resolve(root, TRANSACTION_RELATIVE);
}

function safeTarget(root: string, path: string): string {
  const target = resolve(root, path);
  const child = relative(root, target);
  if (child === ".." || child.startsWith(`..${sep}`))
    throw new RepositoryKnowledgeError(
      "knowledge_recovery_invalid",
      "The knowledge transaction path escapes the repository.",
    );
  return target;
}

async function ensureSafeParent(root: string, target: string): Promise<void> {
  const child = relative(root, dirname(target));
  let current = root;
  for (const segment of child.split(sep).filter(Boolean)) {
    const parent = current;
    current = resolve(current, segment);
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new RepositoryKnowledgeError(
          "knowledge_source_unsafe",
          "The knowledge output parent is not a safe physical directory.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      await syncDirectory(parent);
    }
  }
}

async function pruneEmptyParents(root: string, start: string): Promise<void> {
  let current = start;
  while (current !== root) {
    const child = relative(root, current);
    if (child === ".." || child.startsWith(`..${sep}`)) return;
    try {
      const stats = await lstat(current);
      if (!stats.isDirectory() || stats.isSymbolicLink()) return;
      await rmdir(current);
      current = dirname(current);
    } catch (error) {
      if (["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? ""))
        return;
      throw error;
    }
  }
}

async function writeDurableExclusive(path: string, content: string): Promise<void> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function replaceJournal(
  root: string,
  journal: KnowledgeMaterializationJournal,
): Promise<void> {
  const next = resolve(root, ".journal.next");
  await rm(next, { force: true });
  await writeDurableExclusive(next, `${canonicalJson(journal)}\n`);
  await rename(next, resolve(root, JOURNAL_NAME));
  await syncDirectory(root);
}

async function hashAt(path: string): Promise<string | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new RepositoryKnowledgeError(
        "knowledge_recovery_invalid",
        "The knowledge transaction target is not a safe regular file.",
      );
    return sha256(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function nextPath(transaction: string, index: number): string {
  return resolve(transaction, `next-${index}`);
}

function beforePath(transaction: string, index: number): string {
  return resolve(transaction, `before-${index}`);
}

async function assertBindings(
  root: string,
  operations: JournalOperation[],
  side: "before" | "after",
): Promise<void> {
  for (const operation of operations) {
    if (operation.action === "move" || operation.action === "move_update") {
      const destination = safeTarget(root, operation.destinationPath!);
      const sourceExpected = side === "before" ? operation.beforeHash : null;
      const destinationExpected = side === "before" ? null : operation.afterHash;
      if (
        (await hashAt(safeTarget(root, operation.path))) !== sourceExpected ||
        (await hashAt(destination)) !== destinationExpected
      ) {
        throw new RepositoryKnowledgeError(
          "knowledge_plan_stale",
          `Knowledge move target bytes differ from the ${side} transaction binding at ${operation.path}.`,
        );
      }
      continue;
    }
    const expected = side === "before" ? operation.beforeHash : operation.afterHash;
    if ((await hashAt(safeTarget(root, operation.path))) !== expected)
      throw new RepositoryKnowledgeError(
        "knowledge_plan_stale",
        `Knowledge materialization target bytes differ from the ${side} transaction binding at ${operation.path}.`,
      );
  }
}

async function cleanupTransaction(transaction: string): Promise<void> {
  const parent = dirname(transaction);
  await rm(transaction, { recursive: true });
  await syncDirectory(parent);
}

async function rollback(
  root: string,
  transaction: string,
  journal: KnowledgeMaterializationJournal,
): Promise<void> {
  for (let index = journal.operations.length - 1; index >= 0; index -= 1) {
    const operation = journal.operations[index]!;
    const target = safeTarget(root, operation.path);
    const current = await hashAt(target);
    if (operation.action === "move" || operation.action === "move_update") {
      const destination = safeTarget(root, operation.destinationPath!);
      const destinationHash = await hashAt(destination);
      if (current === operation.beforeHash && destinationHash === null) continue;
      if (
        operation.action === "move_update" &&
        current === null &&
        destinationHash === null &&
        (await hashAt(beforePath(transaction, index))) === operation.beforeHash
      ) {
        await ensureSafeParent(root, target);
        await rename(beforePath(transaction, index), target);
        await syncDirectory(dirname(target));
        await syncDirectory(transaction);
        continue;
      }
      if (current === null && destinationHash === operation.afterHash) {
        await ensureSafeParent(root, target);
        if (operation.action === "move_update") {
          await unlink(destination);
          await rename(beforePath(transaction, index), target);
        } else {
          await rename(destination, target);
        }
        await syncDirectory(dirname(destination));
        if (dirname(destination) !== dirname(target)) await syncDirectory(dirname(target));
        await pruneEmptyParents(root, dirname(destination));
        continue;
      }
      throw new RepositoryKnowledgeError(
        "knowledge_rollback_failed",
        "The move source or destination changed externally and cannot be rolled back safely.",
      );
    }
    if (operation.action === "create") {
      if (current === operation.afterHash) {
        await unlink(target);
        await syncDirectory(dirname(target));
        await pruneEmptyParents(root, dirname(target));
      } else if (current !== null) {
        throw new RepositoryKnowledgeError(
          "knowledge_rollback_failed",
          "The created target changed externally and cannot be rolled back safely.",
        );
      }
      continue;
    }
    const backup = beforePath(transaction, index);
    const backupHash = await hashAt(backup);
    if (current === operation.beforeHash && backupHash === null) continue;
    if (
      (current === operation.afterHash || current === null) &&
      backupHash === operation.beforeHash
    ) {
      if (current !== null && current === operation.afterHash) await unlink(target);
      await ensureSafeParent(root, target);
      await rename(backup, target);
      await syncDirectory(dirname(target));
      await syncDirectory(transaction);
      continue;
    }
    throw new RepositoryKnowledgeError(
      "knowledge_rollback_failed",
      "The updated target and backup state cannot be rolled back safely.",
    );
  }
  await assertBindings(root, journal.operations, "before");
  await cleanupTransaction(transaction);
}

function validJournal(value: unknown): value is KnowledgeMaterializationJournal {
  const item = value as KnowledgeMaterializationJournal | null;
  return (
    item !== null &&
    typeof item === "object" &&
    item.schemaVersion === 1 &&
    item.transactionType === "knowledge_materialization" &&
    /^(?:ksmat|kstruct|kbridgeplan|kinstbootplan|kinstructionplan|klayout|knormplan|kwstreamplan|kpatternplan)_[a-f0-9]{24}$/.test(
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

async function readJournal(root: string): Promise<KnowledgeMaterializationJournal> {
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
      );
    if (error instanceof RepositoryKnowledgeError) throw error;
    throw new RepositoryKnowledgeError(
      "knowledge_recovery_invalid",
      "The knowledge materialization transaction journal is invalid.",
    );
  }
}

function ownerAlive(pid: number): boolean {
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function assertNoKnowledgeMaterializationTransaction(input: {
  repositoryRoot: string;
  allowedPlanId?: string;
}): Promise<void> {
  const root = resolve(input.repositoryRoot);
  try {
    const stat = await lstat(transactionRoot(root));
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new RepositoryKnowledgeError(
        "knowledge_recovery_invalid",
        "The knowledge materialization transaction marker is unsafe.",
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (input.allowedPlanId !== undefined) {
    const journal = await readJournal(root);
    if (journal.planId === input.allowedPlanId && journal.ownerPid === process.pid) return;
  }
  throw new RepositoryKnowledgeError(
    "knowledge_recovery_required",
    "The previous knowledge materialization transaction must be recovered first.",
  );
}

type RecoveryInput = {
  repositoryRoot: string;
  eventRecorded: (planId: string) => boolean;
};

type RecoveryResult = {
  schemaVersion: 1;
  planId: string;
  disposition: "rolled_back" | "committed_cleanup";
};

export function recoverKnowledgeMaterialization(input: RecoveryInput): Promise<RecoveryResult> {
  return withKnowledgeSourceWrite(input.repositoryRoot, () =>
    recoverMaterializationUnderGate(input),
  );
}

async function recoverMaterializationUnderGate(input: RecoveryInput): Promise<RecoveryResult> {
  const root = resolve(input.repositoryRoot);
  const journal = await readJournal(root);
  if (ownerAlive(journal.ownerPid))
    throw new RepositoryKnowledgeError(
      "knowledge_recovery_busy",
      "The knowledge materialization owner process is still running.",
    );
  const transaction = transactionRoot(root);
  const committed = journal.phase === "committed" || input.eventRecorded(journal.planId);
  if (committed) {
    try {
      await assertBindings(root, journal.operations, "after");
      await cleanupTransaction(transaction);
      return { schemaVersion: 1, planId: journal.planId, disposition: "committed_cleanup" };
    } catch (error) {
      throw error instanceof RepositoryKnowledgeError
        ? new RepositoryKnowledgeError(
            "knowledge_recovery_invalid",
            "The committed knowledge materialization output cannot be verified.",
          )
        : error;
    }
  }
  await rollback(root, transaction, journal);
  return { schemaVersion: 1, planId: journal.planId, disposition: "rolled_back" };
}

type DurableApplyInput<T> = {
  repositoryRoot: string;
  projectId: string;
  planId: string;
  operations: Array<
    | KnowledgeFileOperation
    | DurableKnowledgeDeleteOperation
    | DurableKnowledgeMoveOperation
    | DurableKnowledgeMoveUpdateOperation
    | DurableKnowledgeUserFileOperation
  >;
  documentLayoutPermit?: DocumentLayoutPermit | null;
  receipt: T;
  recordApplied: (receipt: T) => void | Promise<void>;
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
};

export function applyDurableKnowledgeOperations<T>(input: DurableApplyInput<T>): Promise<T> {
  return withKnowledgeSourceWrite(input.repositoryRoot, () => applyOperationsUnderGate(input));
}

async function applyOperationsUnderGate<T>(input: DurableApplyInput<T>): Promise<T> {
  const root = resolve(input.repositoryRoot);
  const transaction = transactionRoot(root);
  const changed = input.operations.filter(
    (
      operation,
    ): operation is
      | ((KnowledgeFileOperation | DurableKnowledgeUserFileOperation) & {
          action: "create" | "update";
          content: string;
        })
      | DurableKnowledgeDeleteOperation
      | DurableKnowledgeMoveOperation
      | DurableKnowledgeMoveUpdateOperation =>
      operation.action === "delete" ||
      operation.action === "move" ||
      operation.action === "move_update" ||
      ((operation.action === "create" || operation.action === "update") &&
        operation.content !== undefined),
  );
  if (changed.length > 20_000) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      "The knowledge materialization transaction exceeds the bounded operation limit.",
    );
  }
  if (
    input.operations.some(
      (operation) =>
        (operation.action === "create" || operation.action === "update") &&
        operation.content === undefined,
    )
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The knowledge materialization operation has no content.",
    );
  }
  if (
    changed.some(
      (operation) =>
        operation.action !== "delete" &&
        operation.action !== "move" &&
        sha256(operation.content) !== operation.desiredHash,
    )
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The knowledge materialization operation content hash is invalid.",
    );
  }
  const hasDocumentMutation = changed.some(
    (operation) =>
      /\.mdx?$/iu.test(operation.path) ||
      ("destinationPath" in operation && /\.mdx?$/iu.test(operation.destinationPath)),
  );
  if (hasDocumentMutation && input.documentLayoutPermit == null)
    throw new RepositoryKnowledgeError(
      "document_layout_permit_required",
      "Repository document mutation requires a current projected-layout permit.",
    );
  if (hasDocumentMutation) {
    const evaluation = await evaluateCurrentRepositoryDocumentLayout({
      repositoryRoot: root,
      operations: changed,
    });
    if (
      !validateDocumentLayoutPermit({
        permit: input.documentLayoutPermit!,
        evaluation,
      })
    )
      throw new RepositoryKnowledgeError(
        "document_layout_permit_invalid",
        "The repository document layout permit differs from current bytes, policy, roles, operations, or capacity.",
      );
  }
  if (changed.length === 0) {
    await input.recordApplied(input.receipt);
    return input.receipt;
  }
  const bindings: JournalOperation[] = changed.map((operation) =>
    operation.action === "delete"
      ? {
          path: operation.path,
          action: "delete",
          beforeHash: operation.expectedCurrentHash,
          afterHash: null,
        }
      : operation.action === "move" || operation.action === "move_update"
        ? {
            path: operation.path,
            destinationPath: operation.destinationPath,
            action: operation.action,
            beforeHash: operation.expectedCurrentHash,
            afterHash:
              operation.action === "move_update"
                ? operation.desiredHash
                : operation.expectedCurrentHash,
          }
        : {
            path: operation.path,
            action: operation.action,
            beforeHash: operation.expectedCurrentHash ?? null,
            afterHash: operation.desiredHash,
          },
  );
  await assertBindings(root, bindings, "before");
  const journal: KnowledgeMaterializationJournal = {
    schemaVersion: 1,
    transactionType: "knowledge_materialization",
    planId: input.planId,
    projectId: input.projectId,
    ownerPid: process.pid,
    phase: "preparing",
    publishedCount: 0,
    activeIndex: null,
    operations: bindings,
  };
  const transactionParent = dirname(transaction);
  await ensureSafeParent(root, transaction);
  let preparing: string | undefined;
  try {
    preparing = await mkdtemp(resolve(transactionParent, ".materialization-preparing-"));
    await chmod(preparing, 0o700);
    await replaceJournal(preparing, journal);
    for (let index = 0; index < changed.length; index += 1) {
      const operation = changed[index]!;
      if (operation.action !== "delete" && operation.action !== "move")
        await writeDurableExclusive(nextPath(preparing, index), operation.content);
    }
    journal.phase = "staged";
    await replaceJournal(preparing, journal);
    await syncDirectory(preparing);
    try {
      await lstat(transaction);
      throw new RepositoryKnowledgeError(
        "knowledge_recovery_required",
        "The previous knowledge materialization transaction must be recovered first.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(preparing, transaction);
    preparing = undefined;
    await syncDirectory(transactionParent);
  } catch (error) {
    if (preparing !== undefined) await rm(preparing, { recursive: true, force: true });
    if (error instanceof RepositoryKnowledgeError) throw error;
    if (["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      throw new RepositoryKnowledgeError(
        "knowledge_recovery_required",
        "The previous knowledge materialization transaction must be recovered first.",
      );
    }
    throw new RepositoryKnowledgeError(
      "knowledge_apply_failed",
      "The knowledge materialization transaction could not be started.",
    );
  }
  let interrupted = false;
  let eventRecorded = false;
  const checkpoint = async (name: KnowledgeMaterializationCheckpoint): Promise<void> => {
    if ((await input.failureInjector?.(name)) === "interrupt") {
      interrupted = true;
      throw new Error("simulated interruption");
    }
  };
  try {
    await checkpoint("staged");
    await assertBindings(root, bindings, "before");
    for (let index = 0; index < changed.length; index += 1) {
      const operation = changed[index]!;
      const target = safeTarget(root, operation.path);
      await ensureSafeParent(root, target);
      const destination =
        operation.action === "move" || operation.action === "move_update"
          ? safeTarget(root, operation.destinationPath)
          : undefined;
      if (destination !== undefined) await ensureSafeParent(root, destination);
      journal.phase = "publishing";
      journal.activeIndex = index;
      await replaceJournal(transaction, journal);
      if (operation.action === "move") {
        await rename(target, destination!);
        await syncDirectory(dirname(target));
        if (dirname(destination!) !== dirname(target)) await syncDirectory(dirname(destination!));
        await pruneEmptyParents(root, dirname(target));
        await checkpoint(`original_moved:${index}`);
      } else if (operation.action === "move_update") {
        await rename(target, beforePath(transaction, index));
        await syncDirectory(dirname(target));
        await syncDirectory(transaction);
        await checkpoint(`original_moved:${index}`);
      } else if (operation.action === "update" || operation.action === "delete") {
        await rename(target, beforePath(transaction, index));
        await syncDirectory(dirname(target));
        await syncDirectory(transaction);
        if (operation.action === "delete") await pruneEmptyParents(root, dirname(target));
        await checkpoint(`original_moved:${index}`);
      }
      if (operation.action !== "delete" && operation.action !== "move") {
        const published = operation.action === "move_update" ? destination! : target;
        await rename(nextPath(transaction, index), published);
        await syncDirectory(dirname(published));
        await syncDirectory(transaction);
      }
      journal.publishedCount = index + 1;
      journal.activeIndex = null;
      await replaceJournal(transaction, journal);
      await checkpoint(`published:${index}`);
    }
    await assertBindings(root, bindings, "after");
    journal.phase = "event_recording";
    await replaceJournal(transaction, journal);
    await input.recordApplied(input.receipt);
    eventRecorded = true;
    await checkpoint("event_recorded");
    journal.phase = "committed";
    await replaceJournal(transaction, journal);
    await checkpoint("committed");
    await cleanupTransaction(transaction);
    return input.receipt;
  } catch (error) {
    if (interrupted)
      throw new RepositoryKnowledgeError(
        "knowledge_recovery_required",
        "Interrupted knowledge materialization requires explicit recovery.",
      );
    if (eventRecorded || journal.phase === "committed")
      throw new RepositoryKnowledgeError(
        "knowledge_finalization_failed",
        "Transaction cleanup did not complete after the materialization event.",
      );
    try {
      await rollback(root, transaction, journal);
    } catch (rollbackError) {
      throw rollbackError instanceof RepositoryKnowledgeError
        ? rollbackError
        : new RepositoryKnowledgeError(
            "knowledge_rollback_failed",
            "The failed knowledge materialization could not be rolled back.",
          );
    }
    const domainCode = (error as { code?: unknown } | null)?.code;
    throw error instanceof RepositoryKnowledgeError ||
      (typeof domainCode === "string" &&
        (/^knowledge_[a-z0-9_]+$/u.test(domainCode) || domainCode === "source_bytes_changed"))
      ? error
      : new RepositoryKnowledgeError(
          "knowledge_apply_failed",
          "Knowledge materialization could not be applied and was rolled back to the original state.",
          undefined,
          { cause: error },
        );
  }
}
