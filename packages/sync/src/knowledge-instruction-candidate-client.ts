import { readOwnerOnlyText } from "@lervo/runtime-security";
import {
  isKnowledgeInstructionCandidateRecord,
  type KnowledgeInstructionCandidatePublishStatus,
  type KnowledgeInstructionCandidateRecord,
} from "@lervo/sync-contract";

import { HubJsonHttpClient } from "./hub-json-http-client.js";
import type { HubKnowledgeConvergenceOwnerTarget } from "./knowledge-convergence-owner-client.js";

const MAXIMUM_BEARER_TOKEN_FILE_BYTES = 8_192;
const REQUEST_TIMEOUT_MS = 15_000;

/** Any transport, identity, status, or body failure; the exchange retries next cycle. */
export class HubKnowledgeInstructionCandidateUnavailableError extends Error {
  readonly code = "instruction_candidate_hub_unavailable";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HubKnowledgeInstructionCandidateUnavailableError";
  }
}

/** HTTP adapter for ADR-0467 Hub-hosted owner-rule candidates. */
export class HubKnowledgeInstructionCandidateClient {
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
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      ...(target.fetch === undefined ? {} : { fetch: target.fetch }),
    });
    const base = new URL(target.baseUrl);
    this.url = new URL(
      `v1/sync/projects/${encodeURIComponent(target.projectId)}/knowledge-instruction-candidates`,
      base.href.endsWith("/") ? base : new URL(`${base.href}/`),
    );
    this.url.searchParams.set("destinationId", target.destinationId);
    this.url.searchParams.set("projectIdentityHash", target.repositoryIdentityHash);
  }

  async publish(
    record: KnowledgeInstructionCandidateRecord,
    signal?: AbortSignal,
  ): Promise<KnowledgeInstructionCandidatePublishStatus> {
    if (
      record.projectId !== this.target.projectId ||
      record.repositoryIdentityHash !== this.target.repositoryIdentityHash
    )
      throw new Error("The instruction candidate record names another repository.");
    const body = (await this.request("POST", record, [200, 201], signal)) as {
      status?: unknown;
    } | null;
    const status = body?.status;
    if (status !== "created" && status !== "updated" && status !== "duplicate")
      throw new HubKnowledgeInstructionCandidateUnavailableError(
        "The Hub returned an invalid instruction candidate publish result.",
      );
    return status;
  }

  async list(signal?: AbortSignal): Promise<KnowledgeInstructionCandidateRecord[]> {
    const body = (await this.request("GET", undefined, [200], signal)) as {
      records?: unknown;
    } | null;
    if (!Array.isArray(body?.records) || !body.records.every(isKnowledgeInstructionCandidateRecord))
      throw new HubKnowledgeInstructionCandidateUnavailableError(
        "The Hub returned an invalid instruction candidate list.",
      );
    return body.records;
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
      throw new HubKnowledgeInstructionCandidateUnavailableError(
        "The Hub instruction candidate request failed.",
        { cause: error },
      );
    }
    const response = result as { authentication?: { status?: unknown }; body?: unknown };
    if (response.authentication?.status !== "verified")
      throw new HubKnowledgeInstructionCandidateUnavailableError(
        "The Hub identity did not match the configured Hub.",
      );
    return response.body;
  }
}

/** Reads the owner-only bearer token file, then builds the client. */
export async function createHubKnowledgeInstructionCandidateClient(
  input: HubKnowledgeConvergenceOwnerTarget & {
    bearerTokenFile: string;
    fetch?: typeof globalThis.fetch;
  },
): Promise<HubKnowledgeInstructionCandidateClient> {
  let token: string;
  try {
    token = (
      await readOwnerOnlyText(input.bearerTokenFile, MAXIMUM_BEARER_TOKEN_FILE_BYTES)
    ).trim();
  } catch (error) {
    throw new HubKnowledgeInstructionCandidateUnavailableError(
      "The instruction candidate Hub token file could not be read safely.",
      { cause: error },
    );
  }
  const { bearerTokenFile: _file, ...target } = input;
  return new HubKnowledgeInstructionCandidateClient({ ...target, bearerToken: token });
}
