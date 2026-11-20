import { readOwnerOnlyText } from "@lervo/runtime-security";
import {
  isKnowledgeConvergenceHostPresenceEntry,
  isKnowledgeConvergenceHostRecord,
  type KnowledgeConvergenceHostListing,
  type KnowledgeConvergenceHostPresenceEntry,
  type KnowledgeConvergenceHostPublishStatus,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";

import { HubJsonHttpClient } from "./hub-json-http-client.js";
import { HubKnowledgeConvergenceDefinitionClient } from "./knowledge-convergence-definition-client.js";
import {
  classifyHubOwnerRequestFailure,
  HubKnowledgeConvergenceOwnerUnavailableError,
  type HubKnowledgeConvergenceOwnerTarget,
} from "./knowledge-convergence-owner-client.js";

const MAXIMUM_BEARER_TOKEN_FILE_BYTES = 8_192;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * HTTP adapter for ADR-0469 host continuity records. It uses the owner lease's Hub target and
 * failure causes, so a refused request names `hub_forbidden` or `hub_unreachable` exactly as a
 * refused lease does. `definitions` exchanges the ADR-0477 delegation-bound definitions of the
 * same repository through the same Hub and credential.
 */
export class HubKnowledgeConvergenceHostClient {
  private readonly client: HubJsonHttpClient;
  private readonly url: URL;
  readonly definitions: HubKnowledgeConvergenceDefinitionClient;

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
        "The convergence host Hub coordinates or token are invalid.",
        "hub_configuration_invalid",
        null,
        { cause: error },
      );
    }
    const base = new URL(target.baseUrl);
    this.url = new URL(
      `v1/sync/projects/${encodeURIComponent(target.projectId)}/knowledge-convergence-hosts`,
      base.href.endsWith("/") ? base : new URL(`${base.href}/`),
    );
    this.url.searchParams.set("destinationId", target.destinationId);
    this.url.searchParams.set("projectIdentityHash", target.repositoryIdentityHash);
    this.definitions = new HubKnowledgeConvergenceDefinitionClient(target);
  }

  async publish(
    record: KnowledgeConvergenceHostRecord,
    signal?: AbortSignal,
  ): Promise<KnowledgeConvergenceHostPublishStatus> {
    if (
      record.projectId !== this.target.projectId ||
      record.repositoryIdentityHash !== this.target.repositoryIdentityHash
    )
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The convergence host record names another repository.",
        "hub_configuration_invalid",
      );
    const body = (await this.request("POST", record, [200, 201], signal)) as {
      status?: unknown;
    } | null;
    const status = body?.status;
    if (status !== "created" && status !== "updated" && status !== "stale")
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub returned an invalid convergence host publish result.",
        "hub_response_invalid",
      );
    return status;
  }

  /** ADR-0602: each record carries its host's presence when the Hub reports it. */
  async list(signal?: AbortSignal): Promise<KnowledgeConvergenceHostListing[]> {
    const body = (await this.request("GET", undefined, [200], signal)) as {
      records?: unknown;
      presence?: unknown;
    } | null;
    if (
      !Array.isArray(body?.records) ||
      !body.records.every(isKnowledgeConvergenceHostRecord) ||
      (body.presence !== undefined &&
        (!Array.isArray(body.presence) ||
          !body.presence.every(isKnowledgeConvergenceHostPresenceEntry)))
    )
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub returned an invalid convergence host list.",
        "hub_response_invalid",
      );
    const presence = new Map(
      ((body.presence as KnowledgeConvergenceHostPresenceEntry[] | undefined) ?? []).map(
        ({ hostHash, connected, since }) => [hostHash, { connected, since }],
      ),
    );
    return (body.records as KnowledgeConvergenceHostRecord[]).map((record) => {
      const entry = presence.get(record.hostHash);
      return entry === undefined ? record : { ...record, presence: entry };
    });
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
        "The Hub convergence host request failed.",
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

/** Reads the owner-only bearer token file, then builds the client. */
export async function createHubKnowledgeConvergenceHostClient(
  input: HubKnowledgeConvergenceOwnerTarget & {
    bearerTokenFile: string;
    fetch?: typeof globalThis.fetch;
  },
): Promise<HubKnowledgeConvergenceHostClient> {
  let token: string;
  try {
    token = (
      await readOwnerOnlyText(input.bearerTokenFile, MAXIMUM_BEARER_TOKEN_FILE_BYTES)
    ).trim();
  } catch (error) {
    throw new HubKnowledgeConvergenceOwnerUnavailableError(
      "The convergence host Hub token file could not be read safely.",
      "token_file_unreadable",
      null,
      { cause: error },
    );
  }
  const { bearerTokenFile: _file, ...target } = input;
  return new HubKnowledgeConvergenceHostClient({ ...target, bearerToken: token });
}
