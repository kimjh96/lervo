import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { knowledgeConvergenceOwnerFailureOf } from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  createHubKnowledgeConvergenceOwnerClient,
  HubKnowledgeConvergenceOwnerClient,
  HubKnowledgeConvergenceOwnerUnavailableError,
} from "../src/knowledge-convergence-owner-client.js";

const hubIdentityHash = `sha256:${"9".repeat(64)}`;
const target = {
  baseUrl: "https://hub.example.test/",
  destinationId: "hub:convergence-owner",
  hubIdentityHash,
  projectId: "prj_convergence_owner_client",
  repositoryIdentityHash: `sha256:${"3".repeat(64)}`,
};
const token = "hub-convergence-owner-token-aaaaaaaaaaaaaaaaaaaa";
const claim = {
  operation: "claim" as const,
  request: {
    schemaVersion: 1 as const,
    projectId: target.projectId,
    repositoryIdentityHash: target.repositoryIdentityHash,
    hostHash: `sha256:${"1".repeat(64)}`,
    hostLabel: "wsl",
    ttlMs: 30 * 60_000,
  },
};

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function client(fetch: typeof globalThis.fetch, bearerToken = token) {
  return new HubKnowledgeConvergenceOwnerClient({ ...target, bearerToken, fetch });
}

function answer(status: number, body = "{}", identity = hubIdentityHash): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json", "x-lervo-hub-identity": identity },
  });
}

async function failureOf(work: () => Promise<unknown>) {
  const error = await work().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HubKnowledgeConvergenceOwnerUnavailableError);
  expect((error as HubKnowledgeConvergenceOwnerUnavailableError).code).toBe(
    "convergence_owner_hub_unavailable",
  );
  return knowledgeConvergenceOwnerFailureOf(error);
}

describe("Hub convergence owner client failure codes", () => {
  it.each([
    [401, "hub_unauthorized"],
    [403, "hub_forbidden"],
    [503, "hub_unreachable"],
    [404, "hub_response_invalid"],
  ] as const)("classifies HTTP %i as %s with its status", async (status, failureCode) => {
    expect(await failureOf(() => client(async () => answer(status)).mutate(claim))).toEqual({
      failureCode,
      httpStatus: status,
    });
  });

  it("classifies a missing answer, a foreign identity, and an invalid body", async () => {
    expect(
      await failureOf(() =>
        client(async () => {
          throw new TypeError("fetch failed");
        }).mutate(claim),
      ),
    ).toEqual({ failureCode: "hub_unreachable", httpStatus: null });
    expect(
      await failureOf(() =>
        client(async () => answer(200, "{}", `sha256:${"8".repeat(64)}`)).mutate(claim),
      ),
    ).toEqual({ failureCode: "hub_identity_mismatch", httpStatus: null });
    expect(
      await failureOf(() => client(async () => answer(200, '{"status":"granted"}')).mutate(claim)),
    ).toEqual({ failureCode: "hub_response_invalid", httpStatus: null });
    expect(
      await failureOf(() =>
        client(
          async () =>
            new Response("<html>", {
              status: 200,
              headers: { "content-type": "text/html", "x-lervo-hub-identity": hubIdentityHash },
            }),
        ).mutate(claim),
      ),
    ).toEqual({ failureCode: "hub_response_invalid", httpStatus: null });
  });

  it("classifies unusable configuration and an unreadable token file", async () => {
    expect(
      await failureOf(async () => client(async () => answer(200), "short").mutate(claim)),
    ).toEqual({ failureCode: "hub_configuration_invalid", httpStatus: null });
    expect(
      await failureOf(() =>
        client(async () => answer(200)).mutate({
          ...claim,
          request: { ...claim.request, projectId: "prj_another_repository" },
        }),
      ),
    ).toEqual({ failureCode: "hub_configuration_invalid", httpStatus: null });

    const directory = await mkdtemp(resolve(tmpdir(), "lervo-owner-token-"));
    directories.push(directory);
    expect(
      await failureOf(() =>
        createHubKnowledgeConvergenceOwnerClient({
          ...target,
          bearerTokenFile: resolve(directory, "missing.token"),
        }),
      ),
    ).toEqual({ failureCode: "token_file_unreadable", httpStatus: null });
    const readable = resolve(directory, "shared.token");
    await writeFile(readable, token);
    await chmod(readable, 0o644);
    expect(
      await failureOf(() =>
        createHubKnowledgeConvergenceOwnerClient({ ...target, bearerTokenFile: readable }),
      ),
    ).toEqual({ failureCode: "token_file_unreadable", httpStatus: null });
  });

  it("reads an unclassified error as hub_request_failed", () => {
    expect(knowledgeConvergenceOwnerFailureOf(new Error("boom"))).toEqual({
      failureCode: "hub_request_failed",
      httpStatus: null,
    });
    expect(knowledgeConvergenceOwnerFailureOf({ failureCode: "made_up", httpStatus: 42 })).toEqual({
      failureCode: "hub_request_failed",
      httpStatus: null,
    });
  });
});
