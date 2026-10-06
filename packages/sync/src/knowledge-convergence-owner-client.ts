import { readOwnerOnlyText } from "@lervo/runtime-security";
import {
  isKnowledgeConvergenceOwnerDecision,
  isKnowledgeConvergenceOwnerReading,
  type KnowledgeConvergenceOwnerDecision,
  type KnowledgeConvergenceOwnerFailureCode,
  type KnowledgeConvergenceOwnerMutation,
  type KnowledgeConvergenceOwnerReading,
} from "@lervo/sync-contract";

import { HubJsonHttpClient, HubJsonHttpStatusError } from "./hub-json-http-client.js";

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
 * prove the lease", never as a refusal by another holder. `failureCode` and `httpStatus` name the
 * cause without the message, URL, or token path.
 */
export class HubKnowledgeConvergenceOwnerUnavailableError extends Error {
  readonly code = "convergence_owner_hub_unavailable";

  constructor(
    message: string,
    readonly failureCode: KnowledgeConvergenceOwnerFailureCode,
    readonly httpStatus: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HubKnowledgeConvergenceOwnerUnavailableError";
  }
}

/** Classifies a failed Hub JSON request; only an HTTP status crosses into the failure. */
export function classifyHubOwnerRequestFailure(error: unknown): {
  failureCode: KnowledgeConvergenceOwnerFailureCode;
  httpStatus: number | null;
} {
  if (error instanceof HubJsonHttpStatusError) {
    const httpStatus = error.status;
    if (httpStatus === 401) return { failureCode: "hub_unauthorized", httpStatus };
    if (httpStatus === 403) return { failureCode: "hub_forbidden", httpStatus };
    if (httpStatus >= 500) return { failureCode: "hub_unreachable", httpStatus };
    return { failureCode: "hub_response_invalid", httpStatus };
  }
  const name = (error as { name?: unknown } | null)?.name;
  // fetch rejects with a TypeError when no answer arrives and with an abort on timeout.
  if (error instanceof TypeError || name === "AbortError" || name === "TimeoutError")
    return { failureCode: "hub_unreachable", httpStatus: null };
  return { failureCode: "hub_response_invalid", httpStatus: null };
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
    try {
      this.client = new HubJsonHttpClient({
        bearerToken: target.bearerToken,
        expectedHubIdentityHash: target.hubIdentityHash,
        destinationId: target.destinationId,
        requestTimeoutMs: LEASE_REQUEST_TIMEOUT_MS,
        ...(target.fetch === undefined ? {} : { fetch: target.fetch }),
      });
    } catch (error) {
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The convergence owner Hub coordinates or token are invalid.",
        "hub_configuration_invalid",
        null,
        { cause: error },
      );
    }
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
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The convergence owner mutation names another repository.",
        "hub_configuration_invalid",
      );
    const body = await this.request("POST", mutation, [200, 201], signal);
    if (!isKnowledgeConvergenceOwnerDecision(body))
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub returned an invalid convergence owner decision.",
        "hub_response_invalid",
      );
    return body;
  }

  async read(signal?: AbortSignal): Promise<KnowledgeConvergenceOwnerReading> {
    const body = await this.request("GET", undefined, [200], signal);
    if (!isKnowledgeConvergenceOwnerReading(body))
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub returned an invalid convergence owner reading.",
        "hub_response_invalid",
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
      const failure = classifyHubOwnerRequestFailure(error);
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub convergence owner request failed.",
        failure.failureCode,
        failure.httpStatus,
        { cause: error },
      );
    }
    const response = result as { authentication?: { status?: unknown }; body?: unknown };
    if (response.authentication?.status !== "verified")
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub identity did not match the configured convergence owner Hub.",
        "hub_identity_mismatch",
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
      "token_file_unreadable",
      null,
      { cause: error },
    );
  }
  const { bearerTokenFile: _file, ...target } = input;
  return new HubKnowledgeConvergenceOwnerClient({ ...target, bearerToken: token });
}
