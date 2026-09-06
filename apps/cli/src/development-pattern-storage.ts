import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import type { EventDraft } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";
import { visitEventSnapshot } from "@lervo/storage-contract";

export interface PatternProjection {
  patternId: string;
  state: string;
  providers: string[];
  candidateArtifactId: string | null;
  candidateContentHash: string | null;
  reviewArtifactId: string | null;
  reviewContentHash: string | null;
  supersededByPatternId: string | null;
  previousTargetArtifactId: string | null;
  previousTargetContentHash: string | null;
  activatedRoleId: string | null;
  activatedRoleVersion: string | null;
  activatedRoleContractHash: string | null;
  activatedRoleProfileHash: string | null;
  targetKind: string;
  occurrenceCount: number;
  updatedAt: string;
}

export function allPatternEvents(storage: ProjectStorage): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  const latest = storage.events.latest();
  if (latest !== null)
    visitEventSnapshot({
      events: storage.events,
      throughSeq: latest.seq,
      visit: (event) => {
        if (
          event.type === "development.pattern.observed" ||
          event.type === "development.pattern.transitioned"
        )
          events.push(event);
      },
    });
  return events;
}

export function projectPatterns(events: readonly EventEnvelope[]): PatternProjection[] {
  const patterns = new Map<string, PatternProjection>();
  for (const event of events) {
    const patternId = event.payload.patternId;
    if (typeof patternId !== "string") continue;
    const current = patterns.get(patternId) ?? {
      patternId,
      state: "observed",
      providers: [],
      candidateArtifactId: null,
      candidateContentHash: null,
      reviewArtifactId: null,
      reviewContentHash: null,
      supersededByPatternId: null,
      previousTargetArtifactId: null,
      previousTargetContentHash: null,
      activatedRoleId: null,
      activatedRoleVersion: null,
      activatedRoleContractHash: null,
      activatedRoleProfileHash: null,
      targetKind: "unknown",
      occurrenceCount: 0,
      updatedAt: event.occurredAt,
    };
    if (event.type === "development.pattern.observed") {
      const provider = event.payload.provider;
      if (typeof provider === "string" && !current.providers.includes(provider))
        current.providers.push(provider);
      if (typeof event.payload.occurrenceCount === "number")
        current.occurrenceCount = event.payload.occurrenceCount;
    } else if (event.type === "development.pattern.transitioned") {
      if (typeof event.payload.toState === "string") current.state = event.payload.toState;
      for (const field of [
        "candidateArtifactId",
        "candidateContentHash",
        "reviewArtifactId",
        "reviewContentHash",
        "targetKind",
      ] as const) {
        const value = event.payload[field];
        if (typeof value === "string") current[field] = value;
      }
      for (const field of [
        "previousTargetArtifactId",
        "previousTargetContentHash",
        "activatedRoleId",
        "activatedRoleVersion",
        "activatedRoleContractHash",
        "activatedRoleProfileHash",
      ] as const) {
        const value = event.payload[field];
        if (typeof value === "string" || value === null) current[field] = value;
      }
      const supersededByPatternId = event.payload.supersededByPatternId;
      if (typeof supersededByPatternId === "string" || supersededByPatternId === null)
        current.supersededByPatternId = supersededByPatternId;
    }
    current.updatedAt = event.occurredAt;
    current.providers.sort();
    patterns.set(patternId, current);
  }
  return [...patterns.values()].toSorted((left, right) =>
    left.patternId.localeCompare(right.patternId),
  );
}

export async function writePatternProjection(
  repositoryRoot: string,
  patterns: PatternProjection[],
): Promise<void> {
  const path = resolve(repositoryRoot, ".lervo/state/knowledge/development-patterns/current.json");
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ schemaVersion: 1, patterns }, null, 2)}\n`,
    "utf8",
  );
  await rename(temporary, path);
}

export function patternArtifactId(contentHash: string): string {
  return `art_${contentHash.slice("sha256:".length)}`;
}

export function appendPatternEvent(
  storage: ProjectStorage,
  input: PatternEventInput,
): EventEnvelope {
  return storage.events.append(patternEventDraft(input, storage.manifest.projectId)).event;
}

export interface PatternEventInput {
  type: "development.pattern.observed" | "development.pattern.transitioned";
  payload: Record<string, unknown>;
  occurredAt: string;
}

export function patternEventDraft(input: PatternEventInput, projectId: string): EventDraft {
  const identity = randomUUID().replaceAll("-", "");
  return {
    eventId: `evt_${identity}`,
    projectId,
    runId: `run_${identity}`,
    sessionId: `ses_${identity}`,
    type: input.type,
    occurredAt: input.occurredAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: sha256(canonicalJson(input.payload)),
    payload: input.payload,
  };
}

export async function patternArtifactJson<T>(
  storage: ProjectStorage,
  contentHash: string,
): Promise<T> {
  const bytes = await storage.artifacts.get(
    `lervo-cas://sha256/${contentHash.slice("sha256:".length)}`,
  );
  if (sha256(bytes) !== contentHash) throw new Error("Development-pattern CAS binding changed.");
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
}

export async function patternArtifactText(
  storage: ProjectStorage,
  contentHash: string,
): Promise<string> {
  const bytes = await storage.artifacts.get(
    `lervo-cas://sha256/${contentHash.slice("sha256:".length)}`,
  );
  if (sha256(bytes) !== contentHash) throw new Error("Development-pattern CAS binding changed.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
