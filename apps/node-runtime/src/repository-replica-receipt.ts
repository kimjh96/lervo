import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  REPOSITORY_REPLICA_RECEIPT_PATH,
  isRepositoryReplicaOpenDivergence,
  type RepositoryReplicaOpenDivergence,
} from "@lervo/sync";

import {
  isRepositoryReplicaFailure,
  type RepositoryReplicaFailure,
} from "./repository-replica-failure.js";

export interface RepositoryReplicaFailureRecord extends RepositoryReplicaFailure {
  occurredAt: string;
}

/** Fields that describe the latest unhealthy cycle; a parity receipt is written without them. */
interface RepositoryReplicaAttentionFields {
  lastFailure?: RepositoryReplicaFailureRecord;
  openDivergence?: RepositoryReplicaOpenDivergence;
}

/** Proof of exact parity; readiness accepts only this shape. */
export interface RepositoryReplicaReceipt extends RepositoryReplicaAttentionFields {
  schemaVersion: 1;
  replicaId: string;
  repositoryRoot: string;
  commonSnapshotHash: string;
  localSnapshotHash: string;
  peerSnapshotHash: string;
  reconciledAt: string;
  status: "current" | "pushed" | "pulled" | "merged";
}

/** Written when a replica has never reached parity but has a failure or divergence to report. */
interface RepositoryReplicaAttentionReceipt extends RepositoryReplicaAttentionFields {
  schemaVersion: 1;
  replicaId: string;
  repositoryRoot: string;
  status: "attention";
}

const PARITY_STATUSES = ["current", "pushed", "pulled", "merged"];

function receiptPath(repositoryRoot: string): string {
  return resolve(repositoryRoot, REPOSITORY_REPLICA_RECEIPT_PATH);
}

export async function writeRepositoryReplicaReceipt(
  receipt: RepositoryReplicaReceipt | RepositoryReplicaAttentionReceipt,
): Promise<void> {
  const path = receiptPath(receipt.repositoryRoot);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.next`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function readExistingReceipt(input: {
  repositoryRoot: string;
  replicaId: string;
}): Promise<RepositoryReplicaReceipt | RepositoryReplicaAttentionReceipt> {
  const attention: RepositoryReplicaAttentionReceipt = {
    schemaVersion: 1,
    replicaId: input.replicaId,
    repositoryRoot: input.repositoryRoot,
    status: "attention",
  };
  let value: Partial<RepositoryReplicaReceipt> | null;
  try {
    value = JSON.parse(await readFile(receiptPath(input.repositoryRoot), "utf8")) as typeof value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError)
      return attention;
    throw error;
  }
  if (
    value === null ||
    typeof value !== "object" ||
    value.schemaVersion !== 1 ||
    value.replicaId !== input.replicaId ||
    value.repositoryRoot !== input.repositoryRoot ||
    !PARITY_STATUSES.includes(value.status as string)
  ) {
    return attention;
  }
  const parity = { ...(value as RepositoryReplicaReceipt) };
  if (!isRepositoryReplicaFailure(parity.lastFailure)) delete parity.lastFailure;
  if (!isRepositoryReplicaOpenDivergence(parity.openDivergence)) delete parity.openDivergence;
  return parity;
}

/**
 * Updates the attention fields of the repository-local receipt while keeping the last proven
 * parity. `null` clears a field; an omitted field keeps its current value.
 */
export async function recordRepositoryReplicaAttention(input: {
  repositoryRoot: string;
  replicaId: string;
  lastFailure?: RepositoryReplicaFailureRecord | null;
  openDivergence?: RepositoryReplicaOpenDivergence | null;
}): Promise<void> {
  const receipt = await readExistingReceipt(input);
  if (input.lastFailure === null) delete receipt.lastFailure;
  else if (input.lastFailure !== undefined) receipt.lastFailure = input.lastFailure;
  if (input.openDivergence === null) delete receipt.openDivergence;
  else if (input.openDivergence !== undefined) receipt.openDivergence = input.openDivergence;
  await writeRepositoryReplicaReceipt(receipt);
}
