import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import {
  createNoCapabilityProviderJsonRunner,
  type NoCapabilityProviderJsonRunner,
  type ProviderJsonRequest,
} from "@lervo/repository-knowledge-compiler";
import {
  productionSearchQueryProjectorIdentity,
  repositoryQueryProjectionInstruction,
  repositoryQueryProjectionSystemPrompt,
  searchQueryProjectionResponseSchema,
  searchQueryProjectorIdentity,
  type ProductionQueryProjectorRuntimeContract,
} from "@lervo/repository-context";
import {
  canonicalHash,
  boundProjectedSearchQueries,
  createSearchQueryProjection,
  SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES,
  SEARCH_QUERY_PROJECTION_MAXIMUM_QUERY_CHARACTERS,
  type SearchQueryProjection,
  type SearchQueryProjectionRequest,
  type SearchQueryProjectorPort,
} from "@lervo/search";

import type { RunProvider } from "./managed-run.js";
import {
  prepareDirectProviderQueryRunner,
  prepareProviderQueryRunner,
  type PreparedDirectProviderQueryRunner,
  type PreparedProviderQueryRunner,
  type ProviderQueryRunnerAdmission,
} from "./provider-query-runner.js";

const failedResultDigest = sha256("lervo.provider-query-projector.failed.v1");

interface QueryProjectionBody {
  schemaVersion: 1;
  retrievalQueries: string[];
}

function projectionBody(value: unknown): QueryProjectionBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("The provider query-projection result must be an object.");
  }
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== 2 ||
    body.schemaVersion !== 1 ||
    !Array.isArray(body.retrievalQueries) ||
    body.retrievalQueries.some((query) => typeof query !== "string")
  ) {
    throw new TypeError("The provider query-projection result violates its response contract.");
  }
  return body as unknown as QueryProjectionBody;
}

function assertProjectionRequest(input: SearchQueryProjectionRequest): void {
  const context = canonicalJson(input.context);
  const anchors = input.contextAnchors ?? [];
  if (
    input.request.length === 0 ||
    sha256(input.request) !== input.requestDigest ||
    canonicalHash(input.context) !== input.contextDigest ||
    anchors.length > SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES ||
    new Set(anchors).size !== anchors.length ||
    anchors.some(
      (anchor) =>
        anchor.trim() !== anchor || anchor.length === 0 || !context.includes(canonicalJson(anchor)),
    )
  ) {
    throw new TypeError("The query-projection request does not match its privacy digests.");
  }
}

export interface ProcessSearchQueryProjectorOptions {
  model?: string;
  timeoutMs?: number;
  runtimeContract?: string;
  runner?: NoCapabilityProviderJsonRunner;
  createRunner?: (input: {
    provider: RunProvider;
    model?: string;
    systemPrompt?: string;
    timeoutMs?: number;
  }) => Promise<NoCapabilityProviderJsonRunner>;
  now?: () => number;
  onFailure?: (error: unknown) => void;
}

export { productionSearchQueryProjectorIdentity };
export type { ProductionQueryProjectorRuntimeContract };

export function createProcessSearchQueryProjector(
  provider: RunProvider,
  options: ProcessSearchQueryProjectorOptions = {},
): SearchQueryProjectorPort {
  const createRunner = options.createRunner ?? createNoCapabilityProviderJsonRunner;
  const now = options.now ?? Date.now;
  const model = options.model ?? "provider-default";
  let runner: Promise<NoCapabilityProviderJsonRunner> | undefined =
    options.runner === undefined ? undefined : Promise.resolve(options.runner);
  const projector = searchQueryProjectorIdentity(
    provider,
    model,
    options.runtimeContract ?? "process_per_observation.v1",
  );

  return {
    projector,
    async project(input): Promise<SearchQueryProjection> {
      assertProjectionRequest(input);
      const startedAt = now();
      const limits = input.limits ?? {
        maximumQueries: SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES,
        maximumQueryCharacters: SEARCH_QUERY_PROJECTION_MAXIMUM_QUERY_CHARACTERS,
      };
      const contextAnchors = input.contextAnchors ?? [];
      const generatedLimit = limits.maximumQueries - contextAnchors.length;
      try {
        runner ??= createRunner({
          provider,
          ...(options.model === undefined ? {} : { model: options.model }),
          systemPrompt: repositoryQueryProjectionSystemPrompt,
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        });
        const verifiedRunner = await runner;
        const providerInput = {
          instruction: repositoryQueryProjectionInstruction,
          responseContract: {
            schemaVersion: 1,
            schema: searchQueryProjectionResponseSchema(generatedLimit),
            rawRequestOrKeywordFieldsForbidden: true,
          },
          requestedLanguage: input.requestedLanguage,
          maximumGeneratedQueries: limits.maximumQueries - contextAnchors.length,
          requestDigest: input.requestDigest,
          untrustedRequest: input.request,
          boundedContext: input.context,
        } satisfies ProviderJsonRequest;
        const observation =
          verifiedRunner.resolveObserved === undefined
            ? {
                value: await verifiedRunner.resolve(providerInput, input.signal),
                usage: null,
              }
            : await verifiedRunner.resolveObserved(providerInput, input.signal);
        const resolved = projectionBody(observation.value);
        if (resolved.retrievalQueries.length > limits.maximumQueries) {
          throw new TypeError("The provider returned more queries than the common hard limit.");
        }
        const generatedQueries =
          generatedLimit === 0
            ? []
            : boundProjectedSearchQueries(resolved.retrievalQueries, {
                maximumQueries: generatedLimit,
                maximumQueryCharacters: limits.maximumQueryCharacters,
              });
        const queries = [...new Set([...generatedQueries, ...contextAnchors])];
        return createSearchQueryProjection({
          projector,
          requestDigest: input.requestDigest,
          contextDigest: input.contextDigest,
          projectorResultDigest: sha256(canonicalJson(resolved)),
          requestedLanguage: input.requestedLanguage,
          queries,
          durationMs: now() - startedAt,
          status: queries.length === 0 ? "empty" : "completed",
          limits,
          ...(observation.usage === null ? {} : { usage: observation.usage }),
        });
      } catch (error) {
        if (input.signal?.aborted === true) throw error;
        options.onFailure?.(error);
        return createSearchQueryProjection({
          projector,
          requestDigest: input.requestDigest,
          contextDigest: input.contextDigest,
          projectorResultDigest: failedResultDigest,
          requestedLanguage: input.requestedLanguage,
          queries: [],
          durationMs: now() - startedAt,
          status: "failed",
          limits,
        });
      }
    },
  };
}

export interface PreparedProcessSearchQueryProjector {
  projector: SearchQueryProjectorPort;
  admission: ProviderQueryRunnerAdmission;
  close(): Promise<void>;
}

export interface PreparedDirectProcessSearchQueryProjector {
  projector: SearchQueryProjectorPort;
  runtimeContract: ProductionQueryProjectorRuntimeContract;
  close(): Promise<void>;
}

export interface PreparedProductionSearchQueries {
  projectSearchQueries: ProjectProductionSearchQueries;
  close(): Promise<void>;
}

export async function prepareProcessSearchQueryProjector(
  provider: RunProvider,
  options: Pick<
    ProcessSearchQueryProjectorOptions,
    "model" | "timeoutMs" | "now" | "onFailure"
  > = {},
): Promise<PreparedProcessSearchQueryProjector> {
  const prepared: PreparedProviderQueryRunner = await prepareProviderQueryRunner(provider, {
    ...(options.model === undefined ? {} : { model: options.model }),
    systemPrompt: repositoryQueryProjectionSystemPrompt,
    timeoutMs: options.timeoutMs ?? 20_000,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return {
    projector: createProcessSearchQueryProjector(provider, {
      ...options,
      runner: prepared.runner,
      runtimeContract: prepared.runtimeContract,
    }),
    admission: prepared.admission,
    close: prepared.close,
  };
}

export async function prepareDirectProcessSearchQueryProjector(
  provider: RunProvider,
  options: Pick<
    ProcessSearchQueryProjectorOptions,
    "model" | "timeoutMs" | "now" | "onFailure"
  > = {},
): Promise<PreparedDirectProcessSearchQueryProjector> {
  const prepared: PreparedDirectProviderQueryRunner = await prepareDirectProviderQueryRunner(
    provider,
    {
      ...(options.model === undefined ? {} : { model: options.model }),
      systemPrompt: repositoryQueryProjectionSystemPrompt,
      timeoutMs: options.timeoutMs ?? 20_000,
    },
  );
  return {
    projector: createProcessSearchQueryProjector(provider, {
      ...options,
      runner: prepared.runner,
      runtimeContract: prepared.runtimeContract,
    }),
    runtimeContract: prepared.runtimeContract,
    close: prepared.close,
  };
}

export async function prepareProductionSearchQueries(
  provider: RunProvider,
  prepareProjector: typeof prepareDirectProcessSearchQueryProjector = prepareDirectProcessSearchQueryProjector,
): Promise<PreparedProductionSearchQueries> {
  const prepared = await prepareProjector(provider, { timeoutMs: 20_000 });
  return {
    async projectSearchQueries(input) {
      if (input.provider !== provider) {
        throw new TypeError("The prepared query projector does not match the current provider.");
      }
      return prepared.projector.project(input);
    },
    close: prepared.close,
  };
}

export async function projectProductionSearchQueries(
  input: SearchQueryProjectionRequest & { provider: RunProvider },
  prepareProjector: typeof prepareProductionSearchQueries = prepareProductionSearchQueries,
): Promise<SearchQueryProjection> {
  const startedAt = Date.now();
  let prepared: PreparedProductionSearchQueries;
  try {
    prepared = await prepareProjector(input.provider);
  } catch {
    const limits = input.limits ?? {
      maximumQueries: SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES,
      maximumQueryCharacters: SEARCH_QUERY_PROJECTION_MAXIMUM_QUERY_CHARACTERS,
    };
    return createSearchQueryProjection({
      projector: productionSearchQueryProjectorIdentity(input.provider),
      requestDigest: input.requestDigest,
      contextDigest: input.contextDigest,
      projectorResultDigest: failedResultDigest,
      requestedLanguage: input.requestedLanguage,
      queries: [],
      durationMs: Date.now() - startedAt,
      status: "failed",
      limits,
    });
  }
  try {
    return await prepared.projectSearchQueries(input);
  } finally {
    // A provider process that already failed can also reject while its adapter
    // tears down the process tree. Cleanup is best effort at this boundary: it
    // must not erase the provider-neutral projection receipt or prevent local
    // terminal context from being assembled.
    await prepared.close().catch(() => undefined);
  }
}

export type ProjectProductionSearchQueries = typeof projectProductionSearchQueries;
export type PrepareProductionSearchQueries = typeof prepareProductionSearchQueries;
