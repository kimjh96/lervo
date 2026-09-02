import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import type { EventEnvelope } from "@lervo/schemas";
import { visitEventSnapshot } from "@lervo/storage-contract";

const effectEventTypes = new Set([
  "development.pattern.evaluation.registered",
  "development.pattern.effect.observed",
]);

export function allImprovementEffectEvents(storage: ProjectStorage): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  const latest = storage.events.latest();
  if (latest !== null)
    visitEventSnapshot({
      events: storage.events,
      throughSeq: latest.seq,
      visit: (event) => {
        if (effectEventTypes.has(event.type)) events.push(event);
      },
    });
  return events;
}

export function appendImprovementEffectEvent(
  storage: ProjectStorage,
  input: {
    type: "development.pattern.evaluation.registered" | "development.pattern.effect.observed";
    payload: Record<string, unknown>;
    occurredAt: string;
  },
): EventEnvelope {
  const identity = randomUUID().replaceAll("-", "");
  return storage.events.append({
    eventId: `evt_${identity}`,
    projectId: storage.manifest.projectId,
    runId: `run_${identity}`,
    sessionId: `ses_${identity}`,
    type: input.type,
    occurredAt: input.occurredAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: sha256(canonicalJson(input.payload)),
    payload: input.payload,
  }).event;
}

export async function writeImprovementEffectProjection(
  repositoryRoot: string,
  events: readonly EventEnvelope[],
): Promise<void> {
  const protocols = events
    .filter((event) => event.type === "development.pattern.evaluation.registered")
    .slice(-10_000)
    .map((event) => ({ eventId: event.eventId, ...event.payload }));
  const effects = events
    .filter((event) => event.type === "development.pattern.effect.observed")
    .slice(-10_000)
    .map((event) => ({ eventId: event.eventId, ...event.payload }));
  const path = resolve(repositoryRoot, ".lervo/state/knowledge/improvement-effects/current.json");
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ schemaVersion: 1, protocols, effects }, null, 2)}\n`,
    "utf8",
  );
  await rename(temporary, path);
}
