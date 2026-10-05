import { readOwnerOnlyText } from "@lervo/runtime-security";
import {
  isKnowledgeConvergenceOwnerDecision,
  isKnowledgeConvergenceOwnerReading,
  type KnowledgeConvergenceOwnerDecision,
  type KnowledgeConvergenceOwnerMutation,
  type KnowledgeConvergenceOwnerReading,
} from "@lervo/sync-contract";

import { HubJsonHttpClient } from "./hub-json-http-client.js";

const MAXIMUM_BEARER_TOKEN_FILE_BYTES = 8_192;
const LEASE_REQUEST_TIMEOUT_MS = 15_000;

export interface HubKnowledgeConvergenceOwnerTarget {
  baseUrl: string;
  destinationId: string;
  hubIdentityHash: string;
  projectId: string;
  repositoryIdentityHash: string;
}

/**
 * Any transport, identity, status, or body failure. The caller treats it as "the Hub could not
 * prove the lease", never as a refusal by another holder.
 */
export class HubKnowledgeConvergenceOwnerUnavailableError extends Error {
  readonly code = "convergence_owner_hub_unavailable";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HubKnowledgeConvergenceOwnerUnavailableError";
  }
}

/** HTTP adapter for the ADR-0466 Hub convergence owner lease. */
export class HubKnowledgeConvergenceOwnerClient {
  private readonly client: HubJsonHttpClient;
  private readonly url: URL;

  constructor(
    private readonly target: HubKnowledgeConvergenceOwnerTarget & {
      bearerToken: string;
      fetch?: typeof globalThis.fetch;
    },
  ) {
    this.client = new HubJsonHttpClient({
      bearerToken: target.bearerToken,
      expectedHubIdentityHash: target.hubIdentityHash,
      destinationId: target.destinationId,
      requestTimeoutMs: LEASE_REQUEST_TIMEOUT_MS,
      ...(target.fetch === undefined ? {} : { fetch: target.fetch }),
    });
    const base = new URL(target.baseUrl);
    this.url = new URL(
      `v1/sync/projects/${encodeURIComponent(target.projectId)}/knowledge-convergence-owner`,
      base.href.endsWith("/") ? base : new URL(`${base.href}/`),
    );
    this.url.searchParams.set("destinationId", target.destinationId);
    this.url.searchParams.set("projectIdentityHash", target.repositoryIdentityHash);
  }

  async mutate(
    mutation: KnowledgeConvergenceOwnerMutation,
    signal?: AbortSignal,
  ): Promise<KnowledgeConvergenceOwnerDecision> {
    if (
      mutation.request.projectId !== this.target.projectId ||
      mutation.request.repositoryIdentityHash !== this.target.repositoryIdentityHash
    )
      throw new Error("The convergence owner mutation names another repository.");
    const body = await this.request("POST", mutation, [200, 201], signal);
    if (!isKnowledgeConvergenceOwnerDecision(body))
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub returned an invalid convergence owner decision.",
      );
    return body;
  }

  async read(signal?: AbortSignal): Promise<KnowledgeConvergenceOwnerReading> {
    const body = await this.request("GET", undefined, [200], signal);
    if (!isKnowledgeConvergenceOwnerReading(body))
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub returned an invalid convergence owner reading.",
      );
    return body;
  }

  private async request(
    method: "GET" | "POST",
    body: unknown,
    acceptedStatuses: readonly number[],
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    let result: unknown;
    try {
      result = await this.client.requestJson({
        url: this.url,
        method,
        ...(body === undefined ? {} : { body }),
        acceptedStatuses,
        credentialMode: "bearer",
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub convergence owner request failed.",
        { cause: error },
      );
    }
    const response = result as { authentication?: { status?: unknown }; body?: unknown };
    if (response.authentication?.status !== "verified")
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub identity did not match the configured convergence owner Hub.",
      );
    return response.body;
  }
}

/** Reads the owner-only bearer token file, then builds the client. */
export async function createHubKnowledgeConvergenceOwnerClient(
  input: HubKnowledgeConvergenceOwnerTarget & {
    bearerTokenFile: string;
    fetch?: typeof globalThis.fetch;
  },
): Promise<HubKnowledgeConvergenceOwnerClient> {
  let token: string;
  try {
    token = (
      await readOwnerOnlyText(input.bearerTokenFile, MAXIMUM_BEARER_TOKEN_FILE_BYTES)
    ).trim();
  } catch (error) {
    throw new HubKnowledgeConvergenceOwnerUnavailableError(
      "The convergence owner Hub token file could not be read safely.",
      { cause: error },
    );
  }
  const { bearerTokenFile: _file, ...target } = input;
  return new HubKnowledgeConvergenceOwnerClient({ ...target, bearerToken: token });
}
