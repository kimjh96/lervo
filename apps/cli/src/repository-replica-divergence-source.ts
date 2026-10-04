import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_REPLICA_RECEIPT_PATH,
  readRepositoryReplicaOpenDivergence,
  type RepositoryReplicaOpenDivergence,
} from "@lervo/sync";

import type { TerminalLifecycleInspection } from "./terminal-hook-contract.js";

const MAXIMUM_RECEIPT_BYTES = 64 * 1024;

export type RepositoryReplicaDivergenceSource =
  | { status: "observed"; divergence: RepositoryReplicaOpenDivergence | null }
  | { status: "invalid"; issue: TerminalLifecycleInspection["issues"][number] };

/**
 * Reads the open divergence the replica coordinator projected into this repository's receipt.
 * A repository without replication has no receipt; an unreadable receipt is reported, not hidden.
 */
export async function readRepositoryReplicaDivergence(
  repositoryRoot: string,
): Promise<RepositoryReplicaDivergenceSource> {
  let text: string;
  try {
    text = await readFile(resolve(repositoryRoot, REPOSITORY_REPLICA_RECEIPT_PATH), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { status: "observed", divergence: null };
    text = "";
  }
  try {
    if (text.length === 0 || text.length > MAXIMUM_RECEIPT_BYTES) throw new Error("unreadable");
    return {
      status: "observed",
      divergence: readRepositoryReplicaOpenDivergence(JSON.parse(text) as unknown),
    };
  } catch {
    return {
      status: "invalid",
      issue: {
        code: "repository_replica_receipt_invalid",
        command:
          "inspect .lervo/state/repository-replica.json; the next replica coordinator cycle rewrites it",
      },
    };
  }
}
