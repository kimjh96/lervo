import {
  isKnowledgeConvergenceDefinition,
  isKnowledgeConvergenceDefinitionSummary,
  type KnowledgeConvergenceDefinition,
  type KnowledgeConvergenceDefinitionPublishStatus,
  type KnowledgeConvergenceDefinitionSummary,
} from "@lervo/sync-contract";

import { HubJsonHttpClient } from "./hub-json-http-client.js";
import {
  classifyHubOwnerRequestFailure,
  HubKnowledgeConvergenceOwnerUnavailableError,
  type HubKnowledgeConvergenceOwnerTarget,
} from "./knowledge-convergence-owner-client.js";

const REQUEST_TIMEOUT_MS = 15_000;
const HASH = /^sha256:[a-f0-9]{64}$/u;

/**
 * HTTP adapter for ADR-0477 delegation-bound definitions. Failures carry the owner lease's closed
 * causes; an older Hub without the route answers 404, which stays visible as `httpStatus` so the
 * runtime can name it.
 */
export class HubKnowledgeConvergenceDefinitionClient {
  private readonly client: HubJsonHttpClient;
  private readonly base: URL;

  constructor(
    private readonly target: HubKnowledgeConvergenceOwnerTarget & {
      bearerToken: string;
      fetch?: typeof globalThis.fetch;
    },
  ) {
    try {
      this.client = new HubJsonHttpClient({
        bearerToken: target.bearerToken,
        expectedHubIdentityHash: target.hubIdentityHash,
        destinationId: target.destinationId,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        ...(target.fetch === undefined ? {} : { fetch: target.fetch }),
      });
    } catch (error) {
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The convergence definition Hub coordinates or token are invalid.",
        "hub_configuration_invalid",
        null,
        { cause: error },
      );
    }
    const base = new URL(target.baseUrl);
    this.base = new URL(
      `v1/sync/projects/${encodeURIComponent(target.projectId)}/knowledge-convergence-definitions`,
      base.href.endsWith("/") ? base : new URL(`${base.href}/`),
    );
  }

  private url(contentHash?: string): URL {
    const url = new URL(
      contentHash === undefined ? this.base.href : `${this.base.href}/${contentHash}`,
    );
    url.searchParams.set("destinationId", this.target.destinationId);
    url.searchParams.set("projectIdentityHash", this.target.repositoryIdentityHash);
    return url;
  }

  async publish(
    definition: KnowledgeConvergenceDefinition,
    signal?: AbortSignal,
  ): Promise<KnowledgeConvergenceDefinitionPublishStatus> {
    if (
      definition.projectId !== this.target.projectId ||
      definition.repositoryIdentityHash !== this.target.repositoryIdentityHash
    )
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The convergence definition names another repository.",
        "hub_configuration_invalid",
      );
    const body = (await this.request(this.url(), "POST", definition, [200, 201], signal)) as {
      status?: unknown;
    } | null;
    if (body?.status !== "created" && body?.status !== "refreshed")
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub returned an invalid convergence definition publish result.",
        "hub_response_invalid",
      );
    return body.status;
  }

  async list(signal?: AbortSignal): Promise<KnowledgeConvergenceDefinitionSummary[]> {
    const body = (await this.request(this.url(), "GET", undefined, [200], signal)) as {
      definitions?: unknown;
    } | null;
    if (
      !Array.isArray(body?.definitions) ||
      !body.definitions.every(isKnowledgeConvergenceDefinitionSummary)
    )
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub returned an invalid convergence definition list.",
        "hub_response_invalid",
      );
    return body.definitions;
  }

  /** Null when the Hub holds no definition with this content hash. */
  async read(
    contentHash: string,
    signal?: AbortSignal,
  ): Promise<KnowledgeConvergenceDefinition | null> {
    if (!HASH.test(contentHash))
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The convergence definition content hash is invalid.",
        "hub_configuration_invalid",
      );
    const body = (await this.request(this.url(contentHash), "GET", undefined, [200], signal)) as {
      definition?: unknown;
    } | null;
    const definition = body?.definition;
    if (definition === null) return null;
    if (
      !isKnowledgeConvergenceDefinition(definition) ||
      definition.contentHash !== contentHash ||
      definition.projectId !== this.target.projectId ||
      definition.repositoryIdentityHash !== this.target.repositoryIdentityHash
    )
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub returned an invalid convergence definition.",
        "hub_response_invalid",
      );
    return definition;
  }

  private async request(
    url: URL,
    method: "GET" | "POST",
    body: unknown,
    acceptedStatuses: readonly number[],
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    let result: unknown;
    try {
      result = await this.client.requestJson({
        url,
        method,
        ...(body === undefined ? {} : { body }),
        acceptedStatuses,
        credentialMode: "bearer",
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      const failure = classifyHubOwnerRequestFailure(error);
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub convergence definition request failed.",
        failure.failureCode,
        failure.httpStatus,
        { cause: error },
      );
    }
    const response = result as { authentication?: { status?: unknown }; body?: unknown };
    if (response.authentication?.status !== "verified")
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub identity did not match the configured convergence Hub.",
        "hub_identity_mismatch",
      );
    return response.body;
  }
}
