import {
  calculateProjectIdentityHash,
  createKnowledgeConvergenceDefinition,
  knowledgeConvergenceOwnerFailureOf,
  type KnowledgeConvergenceDefinition,
  type KnowledgeConvergenceDefinitionPublishStatus,
  type KnowledgeConvergenceDefinitionSummary,
} from "@lervo/sync-contract";
import type { ProjectStorage } from "@lervo/project-storage";

import { reproducedBoundDefinitions } from "./delegation-definition-catalog.js";
import type { ConvergenceDefinitionSource } from "./delegation-definition-acceptance.js";
import type { ConvergenceDelegation } from "./delegation-contract.js";

/** The Hub operations the ADR-0477 exchange needs; `@lervo/sync` provides the HTTP adapter. */
export interface ConvergenceDefinitionPort {
  list(signal?: AbortSignal): Promise<KnowledgeConvergenceDefinitionSummary[]>;
  read(contentHash: string, signal?: AbortSignal): Promise<KnowledgeConvergenceDefinition | null>;
  publish(
    definition: KnowledgeConvergenceDefinition,
    signal?: AbortSignal,
  ): Promise<KnowledgeConvergenceDefinitionPublishStatus>;
}

/** A shared definition is published again after this long, so the Hub never prunes it. */
export const DEFINITION_REFRESH_MILLISECONDS = 24 * 60 * 60_000;
/** Candidates read per binding; each one is verified before any is used. */
const MAXIMUM_CANDIDATES = 4;

/** What one reconciliation observed of the exchange; the first failure wins. */
export interface DefinitionExchangeObservation {
  failureCode: string | null;
}

/**
 * The closed cause of a failed exchange request. A Hub without the ADR-0477 route answers 404,
 * which is named `hub_definitions_unsupported` so the remedy is a Hub upgrade, not a credential.
 */
export function definitionExchangeFailureCode(error: unknown): string {
  const failure = knowledgeConvergenceOwnerFailureOf(error);
  return failure.httpStatus === 404 ? "hub_definitions_unsupported" : failure.failureCode;
}

/** Reads candidates through the Hub with one cached listing; failures are observed, not thrown. */
export function hubDefinitionSource(
  port: ConvergenceDefinitionPort,
  observation: DefinitionExchangeObservation,
  signal?: AbortSignal,
): ConvergenceDefinitionSource {
  let listing: Promise<KnowledgeConvergenceDefinitionSummary[]> | null = null;
  const observe = (error: unknown): null => {
    observation.failureCode ??= definitionExchangeFailureCode(error);
    return null;
  };
  return {
    async candidates(kind, bindingHash) {
      listing ??= port.list(signal).catch((error: unknown) => {
        observe(error);
        return [];
      });
      const matching = (await listing)
        .filter((summary) => summary.kind === kind && summary.bindingHash === bindingHash)
        .slice(0, MAXIMUM_CANDIDATES);
      const definitions: KnowledgeConvergenceDefinition[] = [];
      for (const summary of matching) {
        const definition = await port.read(summary.contentHash, signal).catch(observe);
        if (definition?.kind === kind && definition.bindingHash === bindingHash)
          definitions.push(definition);
      }
      return definitions;
    },
  };
}

/**
 * Shares the definitions an active, unexpired delegation binds and this checkout reproduces
 * exactly. Definitions the Hub refreshed within a day are skipped. Returns how many were sent.
 */
export async function publishBoundDefinitions(input: {
  storage: Pick<ProjectStorage, "paths" | "manifest">;
  delegation: ConvergenceDelegation | null;
  port: ConvergenceDefinitionPort;
  hostHash: string;
  now: Date;
  signal?: AbortSignal;
}): Promise<number> {
  const { delegation } = input;
  if (
    delegation === null ||
    delegation.state !== "active" ||
    Date.parse(delegation.expiresAt) <= input.now.getTime()
  )
    return 0;
  const local = await reproducedBoundDefinitions(input.storage.paths.repositoryRoot, delegation);
  if (local.length === 0) return 0;
  const fresh = new Set(
    (await input.port.list(input.signal))
      .filter(
        (summary) =>
          input.now.getTime() - Date.parse(summary.publishedAt) < DEFINITION_REFRESH_MILLISECONDS,
      )
      .map((summary) => summary.contentHash),
  );
  let published = 0;
  for (const item of local) {
    const definition = createKnowledgeConvergenceDefinition({
      projectId: input.storage.manifest.projectId,
      repositoryIdentityHash: calculateProjectIdentityHash(input.storage.manifest),
      kind: item.kind,
      bindingHash: item.bindingHash,
      content: item.content,
      publishedAt: input.now.toISOString(),
      sourceHostHash: input.hostHash,
    });
    // An oversized definition cannot travel; the seeding peer reports it as unavailable.
    if (definition === null || fresh.has(definition.contentHash)) continue;
    await input.port.publish(definition, input.signal);
    published += 1;
  }
  return published;
}
