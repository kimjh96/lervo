import { randomUUID } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { createWorkstreamSuccessorSnapshot } from "@lervo/repository-knowledge";
import { validateSchema, type WorkstreamSnapshot } from "@lervo/schemas";

import { readSupervisionTextArtifact } from "./supervision-artifact-json.js";
import {
  readBoundWorkstreamState,
  type BoundWorkstreamState,
} from "./supervision-workstream-state.js";

/** Matching events one successor scan may observe; history length itself is never bounded. */
const maximumMatchedEvents = 100_000;

export function standingSuccessorMarker(
  successorIndex: number,
  requestContentHash: string,
): string {
  return `Successor goal ${successorIndex} of the standing lineage, started by the installed owner for request ${requestContentHash}.`;
}

async function preparedSuccessor(input: {
  storage: ProjectStorage;
  predecessor: BoundWorkstreamState;
  successorIndex: number;
  requestContentHash: string;
}): Promise<{ workstreamId: string; startEvent: { eventId: string; eventHash: string } } | null> {
  const { storage, predecessor } = input;
  const marker = standingSuccessorMarker(input.successorIndex, input.requestContentHash);
  const lineagePrefix = `Successor goal ${input.successorIndex} of the standing lineage, started by the installed owner for request `;
  const anchor = storage.events.get(predecessor.sourceEventId);
  if (anchor?.eventHash !== predecessor.sourceEventHash)
    throw new Error("The bound successor predecessor event changed.");
  let cursor = anchor.seq;
  let observed = 0;
  let found: { workstreamId: string; startEvent: { eventId: string; eventHash: string } } | null =
    null;
  while (true) {
    const page = storage.events.list({
      afterSeq: cursor,
      limit: 1000,
      types: ["workstream.snapshot.recorded"],
    });
    if (page.length === 0) {
      if (found !== null) {
        const latest = await readBoundWorkstreamState(storage, found.workstreamId);
        if (latest?.snapshot.revision !== 1 || latest.sourceEventId !== found.startEvent.eventId)
          throw new Error("The prepared successor changed before mandate recovery.");
      }
      return found;
    }
    observed += page.length;
    if (observed > maximumMatchedEvents)
      throw new Error("The successor events exceed their source bound.");
    for (const event of page) {
      if (
        event.projectId !== storage.manifest.projectId ||
        event.type !== "workstream.snapshot.recorded" ||
        event.payload.revision !== 1 ||
        event.payload.changeKind !== "agent_start" ||
        event.payload.previousSnapshotContentHash !== predecessor.contentHash
      )
        continue;
      const content = await readSupervisionTextArtifact(
        storage.artifacts,
        String(event.payload.snapshotContentHash),
      );
      if (Buffer.byteLength(content) > 64 * 1024)
        throw new Error("The prepared successor snapshot exceeds its byte bound.");
      let value: unknown;
      try {
        value = JSON.parse(content);
      } catch (error) {
        throw new Error("The prepared successor snapshot is not valid JSON.", { cause: error });
      }
      if (
        !validateSchema("workstreamSnapshot", value).valid ||
        `${canonicalJson(value)}\n` !== content
      )
        throw new Error("The prepared successor snapshot is not canonical.");
      const snapshot = value as WorkstreamSnapshot;
      if (
        snapshot.workstreamId !== event.payload.workstreamId ||
        snapshot.origin.kind !== "successor" ||
        snapshot.origin.predecessorWorkstreamId !== predecessor.snapshot.workstreamId ||
        snapshot.origin.predecessorSnapshotContentHash !== predecessor.contentHash
      )
        continue;
      if (
        snapshot.notes.some((note) => note.startsWith(lineagePrefix)) &&
        !snapshot.notes.includes(marker)
      )
        throw new Error("The standing lineage has a prepared successor for a different request.");
      if (!snapshot.notes.includes(marker)) continue;
      if (found !== null)
        throw new Error("The standing lineage has ambiguous prepared successors.");
      found = {
        workstreamId: snapshot.workstreamId,
        startEvent: { eventId: event.eventId, eventHash: event.eventHash },
      };
    }
    cursor = page.at(-1)!.seq;
  }
}

function hasInstalledSuccessor(
  storage: ProjectStorage,
  predecessor: BoundWorkstreamState,
  supervisionId: string,
): boolean {
  const anchor = storage.events.get(predecessor.sourceEventId);
  if (anchor?.eventHash !== predecessor.sourceEventHash)
    throw new Error("The bound successor predecessor event changed.");
  let cursor = anchor.seq;
  let observed = 0;
  while (true) {
    const page = storage.events.list({
      afterSeq: cursor,
      limit: 1000,
      types: ["work.supervision.mandate.installed"],
    });
    if (page.length === 0) return false;
    observed += page.length;
    if (observed > maximumMatchedEvents)
      throw new Error("The successor events exceed their source bound.");
    if (
      page.some(
        (event) =>
          event.projectId === storage.manifest.projectId &&
          event.type === "work.supervision.mandate.installed" &&
          event.payload.supervisionId === supervisionId,
      )
    )
      return true;
    cursor = page.at(-1)!.seq;
  }
}

/** Starts a successor from an exact settled goal without moving another selected workstream. */
export async function recordUnselectedStandingSuccessor(input: {
  storage: ProjectStorage;
  predecessor: BoundWorkstreamState;
  draft: unknown;
  provider: "codex" | "claude";
  supervisionId: string;
  successorIndex: number;
  requestContentHash: string;
  now(): string;
}): Promise<{ workstreamId: string; startEvent: { eventId: string; eventHash: string } }> {
  const { storage, predecessor } = input;
  if (hasInstalledSuccessor(storage, predecessor, input.supervisionId))
    throw new Error("The standing lineage already has an installed successor.");
  const prepared = await preparedSuccessor(input);
  if (prepared !== null) return prepared;
  const snapshot = createWorkstreamSuccessorSnapshot({
    projectId: storage.manifest.projectId,
    draft: input.draft,
    predecessor: {
      workstreamId: predecessor.snapshot.workstreamId,
      contentHash: predecessor.contentHash,
    },
  });
  if (snapshot === null) throw new Error("The bound successor goal draft is invalid.");
  const content = `${canonicalJson(snapshot)}\n`;
  const artifact = await storage.artifacts.put(content);
  const identity = randomUUID().replaceAll("-", "");
  const head = storage.events.latest();
  const appended = storage.events.transact((transaction) => {
    if (storage.events.latest()?.eventHash !== head?.eventHash)
      throw new Error("The event head changed before bound successor creation.");
    if (hasInstalledSuccessor(storage, predecessor, input.supervisionId))
      throw new Error("The standing lineage already has an installed successor.");
    return transaction.append({
      eventId: `evt_${identity}`,
      projectId: storage.manifest.projectId,
      runId: `run_${identity}`,
      sessionId: `ses_${identity}`,
      type: "workstream.snapshot.recorded",
      occurredAt: input.now(),
      actor: { kind: "agent", provider: input.provider },
      schemaVersion: 1,
      policyVersion: artifact.contentHash,
      payload: {
        workstreamId: snapshot.workstreamId,
        revision: 1,
        status: snapshot.status,
        changeKind: "agent_start",
        snapshotArtifactId: `art_${artifact.contentHash.slice(7)}`,
        snapshotContentHash: artifact.contentHash,
        previousSnapshotContentHash: predecessor.contentHash,
        sourceArtifactId: null,
        sourceContentHash: null,
        recordedAt: input.now(),
      },
    });
  });
  return {
    workstreamId: snapshot.workstreamId,
    startEvent: { eventId: appended.event.eventId, eventHash: appended.event.eventHash },
  };
}
