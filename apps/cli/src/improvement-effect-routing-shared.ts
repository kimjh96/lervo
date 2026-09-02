import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ImprovementEvaluationProtocolRequestV1 } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  sha256,
  type DevelopmentPatternCandidate,
} from "@lervo/repository-knowledge";
import type { EventEnvelope } from "@lervo/schemas";

export function exactImprovementDescriptor(
  expected: ImprovementEvaluationProtocolRequestV1["adapter"],
  actual: ImprovementEvaluationProtocolRequestV1["adapter"],
): boolean {
  return canonicalJson(expected) === canonicalJson(actual);
}

export async function putImprovementJsonArtifact(
  storage: Awaited<ReturnType<typeof openProjectStorage>>,
  value: unknown,
) {
  const content = `${canonicalJson(value)}\n`;
  const stored = await storage.artifacts.put(content);
  if (stored.contentHash !== sha256(content)) throw new Error("Improvement-effect CAS mismatch.");
  return stored;
}

export async function currentImprovementTargetHash(
  repositoryRoot: string,
  candidate: DevelopmentPatternCandidate,
): Promise<string> {
  const content = await readFile(resolve(repositoryRoot, candidate.target.path), "utf8");
  if (Buffer.byteLength(content) > 128 * 1024)
    throw new Error("The promoted pattern target exceeds the bounded read limit.");
  return sha256(content);
}

export function findImprovementEvent(
  events: readonly EventEnvelope[],
  type: EventEnvelope["type"],
  field: string,
  value: string,
): EventEnvelope | undefined {
  return events.find((event) => event.type === type && event.payload[field] === value);
}
