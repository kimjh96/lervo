import { readOwnerOnlyText } from "@lervo/runtime-security";

import { holdHubRequest } from "./hub-held-request.js";
import {
  classifyHubOwnerRequestFailure,
  HubKnowledgeConvergenceOwnerUnavailableError,
  type HubKnowledgeConvergenceOwnerTarget,
} from "./knowledge-convergence-owner-client.js";

const MAXIMUM_BEARER_TOKEN_FILE_BYTES = 8_192;
const CURSOR = /^[a-f0-9-]{36}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;

/** A socket that failed without an HTTP answer: the Hub or the network is not there. */
function unreachable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    typeof code === "string" && /^(E[A-Z]+|ERR_SOCKET_[A-Z_]+|ERR_HUB_HOLD_DEADLINE)$/u.test(code)
  );
}

/**
 * ADR-0602 HTTP adapter for the Hub's `knowledge` change waits, through the same Hub, credential
 * and failure causes as the owner lease. Each wait is an open hold that answers only when the
 * repository's coordination state changed for another host than `hostHash`.
 */
export class HubKnowledgeChangeClient {
  private readonly url: URL;

  constructor(
    private readonly target: HubKnowledgeConvergenceOwnerTarget & { bearerToken: string },
  ) {
    const base = new URL(target.baseUrl);
    if (
      (base.protocol !== "https:" && base.protocol !== "http:") ||
      !HASH.test(target.hubIdentityHash) ||
      !HASH.test(target.repositoryIdentityHash)
    )
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The knowledge change Hub coordinates are invalid.",
        "hub_configuration_invalid",
      );
    this.url = new URL(
      `v1/runtime-changes/projects/${encodeURIComponent(target.projectId)}`,
      base.href.endsWith("/") ? base : new URL(`${base.href}/`),
    );
    this.url.searchParams.set("destinationId", target.destinationId);
    this.url.searchParams.set("repositoryIdentityHash", target.repositoryIdentityHash);
    this.url.searchParams.set("topic", "knowledge");
    this.url.searchParams.set("hold", "open");
  }

  async wait(input: {
    cursor: string | null;
    hostHash: string | null;
    signal: AbortSignal;
  }): Promise<{ cursor: string }> {
    const url = new URL(this.url);
    if (input.cursor !== null) url.searchParams.set("cursor", input.cursor);
    if (input.hostHash !== null) url.searchParams.set("hostHash", input.hostHash);
    let result: Awaited<ReturnType<typeof holdHubRequest>>;
    try {
      result = await holdHubRequest({
        url,
        bearerToken: this.target.bearerToken,
        expectedHubIdentityHash: this.target.hubIdentityHash,
        destinationId: this.target.destinationId,
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal.aborted) throw error;
      const failure = unreachable(error)
        ? { failureCode: "hub_unreachable" as const, httpStatus: null }
        : classifyHubOwnerRequestFailure(error);
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub knowledge change wait failed.",
        failure.failureCode,
        failure.httpStatus,
        { cause: error },
      );
    }
    if (result.authentication.status !== "verified")
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub identity did not match the configured convergence Hub.",
        "hub_identity_mismatch",
      );
    const body = result.body as { schemaVersion?: unknown; cursor?: unknown; status?: unknown };
    if (
      body?.schemaVersion !== 1 ||
      typeof body.cursor !== "string" ||
      !CURSOR.test(body.cursor) ||
      (body.status !== "changed" && body.status !== "timeout")
    )
      throw new HubKnowledgeConvergenceOwnerUnavailableError(
        "The Hub returned an invalid knowledge change answer.",
        "hub_response_invalid",
      );
    return { cursor: body.cursor };
  }
}

/** Reads the owner-only bearer token file, then builds the client. */
export async function createHubKnowledgeChangeClient(
  input: HubKnowledgeConvergenceOwnerTarget & { bearerTokenFile: string },
): Promise<HubKnowledgeChangeClient> {
  let token: string;
  try {
    token = (
      await readOwnerOnlyText(input.bearerTokenFile, MAXIMUM_BEARER_TOKEN_FILE_BYTES)
    ).trim();
  } catch (error) {
    throw new HubKnowledgeConvergenceOwnerUnavailableError(
      "The knowledge change Hub token file could not be read safely.",
      "token_file_unreadable",
      null,
      { cause: error },
    );
  }
  const { bearerTokenFile: _file, ...target } = input;
  return new HubKnowledgeChangeClient({ ...target, bearerToken: token });
}
