import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import {
  listDurableInstructionCandidates,
  removeDurableInstructionCandidate,
  sha256,
  storeDurableInstructionCandidate,
  validateDurableInstructionCandidate,
  type DurableInstructionCandidate,
  type DurableInstructionCandidateInspection,
} from "@lervo/repository-knowledge";
import {
  calculateProjectIdentityHash,
  knowledgeInstructionCandidateHash,
  type KnowledgeInstructionCandidatePublishStatus,
  type KnowledgeInstructionCandidateRecord,
} from "@lervo/sync-contract";

import {
  readConvergenceOwnerHost,
  type ConvergenceOwnerHubCoordinates,
} from "./convergence-owner-host.js";
import { appendInstructionCaptureEvent } from "./instruction-capture-events.js";
import {
  readInstructionCandidateExchangeState,
  writeInstructionCandidateExchangeState,
} from "./instruction-candidate-exchange-state.js";

/** The Hub adapter the CLI and Node compositions inject (ADR-0467). */
export interface InstructionCandidateExchangePort {
  publish(
    record: KnowledgeInstructionCandidateRecord,
  ): Promise<KnowledgeInstructionCandidatePublishStatus>;
  list(): Promise<KnowledgeInstructionCandidateRecord[]>;
}

export type InstructionCandidateExchangeTransport = (
  target: ConvergenceOwnerHubCoordinates & { projectId: string; repositoryIdentityHash: string },
) => Promise<InstructionCandidateExchangePort>;

export type InstructionCandidateExchangeResult =
  /** No Hub coordination is configured: candidates stay on this host, as on a single host. */
  | { status: "standalone" }
  /** The Hub could not be reached or answered invalidly; the next cycle retries everything. */
  | { status: "unavailable" }
  | { status: "exchanged"; published: number; imported: number; resolved: number };

/** The candidate's own record, without the host-local inspection fields. */
function plainCandidate(
  candidate: DurableInstructionCandidateInspection,
): DurableInstructionCandidate {
  const { candidateHash: _hash, artifactPath: _path, ...plain } = candidate;
  return plain;
}

async function alreadyApplied(
  root: string,
  candidate: DurableInstructionCandidate,
): Promise<boolean> {
  try {
    return (
      sha256(await readFile(resolve(root, candidate.targetPath), "utf8")) ===
      candidate.proposedContentHash
    );
  } catch {
    return false;
  }
}

function exchangedEvent(input: {
  storage: ProjectStorage;
  candidate: DurableInstructionCandidate;
  direction: "published" | "imported" | "resolved";
  resolution: KnowledgeInstructionCandidateRecord["resolution"];
  sourceHostHash: string;
  occurredAt: string;
}): void {
  appendInstructionCaptureEvent({
    storage: input.storage,
    type: "knowledge.instruction_candidate.exchanged",
    correlationId: `${input.direction}\0${input.resolution}\0${input.candidate.proposedContentHash}`,
    occurredAt: input.occurredAt,
    payload: {
      candidateId: input.candidate.candidateId,
      proposedContentHash: input.candidate.proposedContentHash,
      ruleId: input.candidate.ruleId,
      direction: input.direction,
      resolution: input.resolution,
      sourceHostHash: input.sourceHostHash,
      occurredAt: input.occurredAt,
    },
  });
}

/**
 * ADR-0467 cross-host candidate exchange. Each host publishes the candidates it assessed and the
 * resolutions it decided, imports every open candidate it does not hold, and removes candidates
 * another host resolved. Records carry normalized rules and digests only; owner turns never leave
 * the host that observed them. One rule is one record, keyed by its proposed Markdown hash.
 */
export async function exchangeInstructionCandidates(input: {
  storage: ProjectStorage;
  transport?: InstructionCandidateExchangeTransport;
  now: () => Date;
}): Promise<InstructionCandidateExchangeResult> {
  const root = input.storage.paths.repositoryRoot;
  let host: Awaited<ReturnType<typeof readConvergenceOwnerHost>>;
  try {
    host = await readConvergenceOwnerHost(root);
  } catch {
    return { status: "unavailable" };
  }
  if (host === null || host.config.coordination.mode !== "hub") return { status: "standalone" };
  if (input.transport === undefined) return { status: "unavailable" };
  const projectId = input.storage.manifest.projectId;
  const repositoryIdentityHash = calculateProjectIdentityHash(input.storage.manifest);
  let port: InstructionCandidateExchangePort;
  let remote: KnowledgeInstructionCandidateRecord[];
  try {
    port = await input.transport({
      ...host.config.coordination.hub,
      projectId,
      repositoryIdentityHash,
    });
    remote = await port.list();
  } catch {
    return { status: "unavailable" };
  }
  const state = await readInstructionCandidateExchangeState(root);
  const known = new Set(state.known);
  const resolvedHashes = new Set(state.resolved);
  const result = { published: 0, imported: 0, resolved: 0 };
  const record = (
    candidate: DurableInstructionCandidate,
    resolution: KnowledgeInstructionCandidateRecord["resolution"],
    resolvedAt: string | null,
  ): KnowledgeInstructionCandidateRecord => ({
    schemaVersion: 1,
    projectId,
    repositoryIdentityHash,
    proposedContentHash: candidate.proposedContentHash,
    candidateHash: knowledgeInstructionCandidateHash(candidate),
    candidate: candidate as unknown as Record<string, unknown>,
    sourceHostHash: host.hostHash,
    resolution,
    resolvedByHostHash: resolution === "open" ? null : host.hostHash,
    publishedAt: input.now().toISOString(),
    resolvedAt,
  });
  try {
    // 1. This host's resolutions first, so a rule it just applied never reappears as open.
    const pending = [];
    for (const entry of state.pendingResolutions) {
      try {
        await port.publish(record(entry.candidate, entry.resolution, entry.resolvedAt));
        exchangedEvent({
          storage: input.storage,
          candidate: entry.candidate,
          direction: "published",
          resolution: entry.resolution,
          sourceHostHash: host.hostHash,
          occurredAt: input.now().toISOString(),
        });
      } catch {
        pending.push(entry);
      }
    }
    state.pendingResolutions = pending;
    // 2. Resolutions from any host remove the local copy; open records are imported once.
    for (const item of remote) {
      if (item.projectId !== projectId) continue;
      if (item.resolution !== "open") {
        resolvedHashes.add(item.proposedContentHash);
        for (const local of await listDurableInstructionCandidates(root)) {
          if (local.proposedContentHash !== item.proposedContentHash) continue;
          await removeDurableInstructionCandidate({
            repositoryRoot: root,
            candidateId: local.candidateId,
            expectedCandidateHash: local.candidateHash,
          });
          result.resolved += 1;
          exchangedEvent({
            storage: input.storage,
            candidate: plainCandidate(local),
            direction: "resolved",
            resolution: item.resolution,
            sourceHostHash: item.resolvedByHostHash ?? item.sourceHostHash,
            occurredAt: input.now().toISOString(),
          });
        }
        continue;
      }
      known.add(item.proposedContentHash);
      if (resolvedHashes.has(item.proposedContentHash)) continue;
      const local = await listDurableInstructionCandidates(root);
      if (local.some((candidate) => candidate.proposedContentHash === item.proposedContentHash))
        continue;
      let candidate: DurableInstructionCandidate;
      try {
        candidate = validateDurableInstructionCandidate(item.candidate);
      } catch {
        continue;
      }
      if (candidate.projectId !== projectId || (await alreadyApplied(root, candidate))) continue;
      await storeDurableInstructionCandidate({ repositoryRoot: root, candidate });
      result.imported += 1;
      exchangedEvent({
        storage: input.storage,
        candidate,
        direction: "imported",
        resolution: "open",
        sourceHostHash: item.sourceHostHash,
        occurredAt: input.now().toISOString(),
      });
    }
    // 3. This host's own open candidates that no host has seen yet.
    for (const local of await listDurableInstructionCandidates(root)) {
      if (known.has(local.proposedContentHash) || resolvedHashes.has(local.proposedContentHash))
        continue;
      const candidate = plainCandidate(local);
      await port.publish(record(candidate, "open", null));
      known.add(local.proposedContentHash);
      result.published += 1;
      exchangedEvent({
        storage: input.storage,
        candidate,
        direction: "published",
        resolution: "open",
        sourceHostHash: host.hostHash,
        occurredAt: input.now().toISOString(),
      });
    }
  } catch {
    await writeInstructionCandidateExchangeState(root, {
      ...state,
      known: [...known],
      resolved: [...resolvedHashes],
    });
    return { status: "unavailable" };
  }
  await writeInstructionCandidateExchangeState(root, {
    ...state,
    known: [...known],
    resolved: [...resolvedHashes],
  });
  return { status: "exchanged", ...result };
}
