import { createRemoteCommand } from "@lervo/remote-command-contract";
import type { SignedRemoteCommand } from "@lervo/schemas";
import { describe, expect, it, vi } from "vitest";

import { AuthenticatedRemoteCommandHttpSubmission } from "../src/index.js";

const target = {
  projectId: "prj_http_submit01",
  projectIdentityHash: `sha256:${"2".repeat(64)}`,
};
const continuation = {
  workstreamId: `wks_${"3".repeat(24)}`,
  revision: 7,
  snapshotContentHash: `sha256:${"4".repeat(64)}`,
  assignmentId: `asn_${"5".repeat(24)}`,
  agentId: `agt_${"6".repeat(24)}`,
};
const request = {
  idempotencyKey: "idk_http_submission_01",
  lifetimeMs: 120_000,
  roleId: "developer",
  provider: "codex",
  risk: "medium" as const,
  verificationSuiteIds: ["repo.check"],
  request: "Continue the exact active workstream.",
  continuation,
};

function envelope(): SignedRemoteCommand {
  return {
    schemaVersion: 1,
    command: createRemoteCommand({
      idempotencyKey: request.idempotencyKey,
      nonce: Buffer.alloc(32, 7).toString("base64url"),
      issuedAt: "2026-09-07T09:00:00.000Z",
      expiresAt: "2026-09-07T09:02:00.000Z",
      target,
      action: {
        kind: "managed_run",
        roleId: request.roleId,
        provider: request.provider,
        risk: request.risk,
        verificationSuiteIds: request.verificationSuiteIds,
        request: {
          artifactId: "art_http_submission_01",
          contentHash: `sha256:${"8".repeat(64)}`,
          byteCount: Buffer.byteLength(request.request),
          mediaType: "text/plain; charset=utf-8",
        },
        continuation,
      },
    }),
    signature: {
      algorithm: "ed25519",
      keyId: "key_http_submission_01",
      value: Buffer.alloc(64, 9).toString("base64url"),
    },
  };
}

const options = {
  baseUrl: "https://hub.example.test/base",
  bearerToken: `hub-token-${"a".repeat(40)}`,
  expectedHubIdentityHash: `sha256:${"1".repeat(64)}`,
  destinationId: "hub:http-submission",
  target,
};

describe("authenticated remote command HTTP submission", () => {
  it("posts the exact continuation request and verifies the Hub response coordinates", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/base/v1/commands/projects/prj_http_submit01/submissions");
      expect(url.searchParams.get("destinationId")).toBe(options.destinationId);
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${options.bearerToken}` });
      expect(JSON.parse(String(init?.body))).toEqual({ schemaVersion: 1, ...request });
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "created",
          destinationId: options.destinationId,
          target,
          deliveryId: `rcd_${"b".repeat(64)}`,
          queuedAt: "2026-09-07T09:00:00.000Z",
          envelope: envelope(),
        }),
        {
          status: 201,
          headers: {
            "content-type": "application/json",
            "x-lervo-hub-identity": options.expectedHubIdentityHash,
          },
        },
      );
    });
    const client = new AuthenticatedRemoteCommandHttpSubmission({ ...options, fetch });

    await expect(client.submit(request)).resolves.toMatchObject({
      status: "created",
      destinationId: options.destinationId,
      target,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects an unverified Hub identity", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("{}", {
          status: 201,
          headers: {
            "content-type": "application/json",
            "x-lervo-hub-identity": `sha256:${"f".repeat(64)}`,
          },
        }),
    );
    const client = new AuthenticatedRemoteCommandHttpSubmission({ ...options, fetch });

    await expect(client.submit(request)).rejects.toThrow("identity is unverified");
  });

  it("rejects an invalid continuation before network access", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new AuthenticatedRemoteCommandHttpSubmission({ ...options, fetch });

    await expect(
      client.submit({
        ...request,
        continuation: { ...continuation, revision: 0 },
      }),
    ).rejects.toThrow("submission request is invalid");
    expect(fetch).not.toHaveBeenCalled();
  });
});
