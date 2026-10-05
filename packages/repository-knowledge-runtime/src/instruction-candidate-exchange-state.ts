import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DurableInstructionCandidate } from "@lervo/repository-knowledge";

import { INSTRUCTION_CAPTURE_ROOT } from "./instruction-capture-queue.js";

/**
 * Host-local bookkeeping for the ADR-0467 cross-host candidate exchange: which candidates this
 * host already published or imported, which rules are resolved, and resolutions this host decided
 * that the Hub has not acknowledged yet. Rebuildable from the Hub list; never tracked.
 */
export const INSTRUCTION_CANDIDATE_EXCHANGE_STATE_PATH = `${INSTRUCTION_CAPTURE_ROOT}/exchange.json`;
const MAXIMUM_KNOWN = 128;
const MAXIMUM_PENDING_RESOLUTIONS = 16;
const MAXIMUM_STATE_BYTES = 512 * 1024;

export interface PendingInstructionCandidateResolution {
  proposedContentHash: string;
  resolution: "applied" | "rejected";
  /** The reviewed candidate; the Hub record must carry it even after local removal. */
  candidate: DurableInstructionCandidate;
  resolvedAt: string;
}

export interface InstructionCandidateExchangeState {
  schemaVersion: 1;
  /** Proposed-content hashes already on the Hub from this host, or imported from it. */
  known: string[];
  /** Proposed-content hashes resolved anywhere; never imported again. */
  resolved: string[];
  pendingResolutions: PendingInstructionCandidateResolution[];
}

export function emptyInstructionCandidateExchangeState(): InstructionCandidateExchangeState {
  return { schemaVersion: 1, known: [], resolved: [], pendingResolutions: [] };
}

export async function readInstructionCandidateExchangeState(
  root: string,
): Promise<InstructionCandidateExchangeState> {
  try {
    const path = resolve(root, INSTRUCTION_CANDIDATE_EXCHANGE_STATE_PATH);
    const observed = await lstat(path);
    if (!observed.isFile() || observed.size > MAXIMUM_STATE_BYTES)
      return emptyInstructionCandidateExchangeState();
    const value = JSON.parse(
      await readFile(path, "utf8"),
    ) as Partial<InstructionCandidateExchangeState>;
    if (
      value.schemaVersion !== 1 ||
      !Array.isArray(value.known) ||
      !Array.isArray(value.resolved) ||
      !Array.isArray(value.pendingResolutions)
    )
      return emptyInstructionCandidateExchangeState();
    return value as InstructionCandidateExchangeState;
  } catch {
    return emptyInstructionCandidateExchangeState();
  }
}

export async function writeInstructionCandidateExchangeState(
  root: string,
  state: InstructionCandidateExchangeState,
): Promise<void> {
  const bounded: InstructionCandidateExchangeState = {
    schemaVersion: 1,
    known: [...new Set(state.known)].slice(-MAXIMUM_KNOWN),
    resolved: [...new Set(state.resolved)].slice(-MAXIMUM_KNOWN),
    pendingResolutions: state.pendingResolutions.slice(-MAXIMUM_PENDING_RESOLUTIONS),
  };
  let directory = resolve(root);
  for (const part of INSTRUCTION_CAPTURE_ROOT.split("/")) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  const temporary = resolve(directory, `.exchange-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(bounded)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, resolve(root, INSTRUCTION_CANDIDATE_EXCHANGE_STATE_PATH));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Called by the review path after it applied or rejected a candidate, before removing it, so the
 * next exchange tells every host. A no-op for single-host repositories beyond local bookkeeping.
 */
export async function recordInstructionCandidateResolution(input: {
  repositoryRoot: string;
  candidate: DurableInstructionCandidate;
  resolution: "applied" | "rejected";
  resolvedAt: Date;
}): Promise<void> {
  const state = await readInstructionCandidateExchangeState(input.repositoryRoot);
  const proposedContentHash = input.candidate.proposedContentHash;
  await writeInstructionCandidateExchangeState(input.repositoryRoot, {
    ...state,
    resolved: [...state.resolved, proposedContentHash],
    pendingResolutions: [
      ...state.pendingResolutions.filter(
        (entry) => entry.proposedContentHash !== proposedContentHash,
      ),
      {
        proposedContentHash,
        resolution: input.resolution,
        candidate: input.candidate,
        resolvedAt: input.resolvedAt.toISOString(),
      },
    ],
  });
}
