import { createHash, generateKeyPairSync, sign } from "node:crypto";

import {
  createSignedRemoteCommandEnvelope,
  remoteCommandSigningBytes,
} from "@lervo/remote-command-contract";
import type { RemoteCommand, RemoteCommandTarget } from "@lervo/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  authorHubCommand,
  type HubCommandAuthorshipRecord,
  type HubCommandAuthoringStore,
} from "../src/index.js";

const destinationId = "hub:authoring-test";
const target: RemoteCommandTarget = {
  projectId: "prj_authoring_test_01",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
};
const request = {
  idempotencyKey: "idk_authoring_retry_01",
  lifetimeMs: 120_000,
  roleId: "developer",
  provider: "custom_provider",
  risk: "medium" as const,
  verificationSuiteIds: ["repo.check"],
  request: "사람이 이해할 수 있는 실제 요청",
};

function fixture() {
  let record: HubCommandAuthorshipRecord | null = null;
  const bytes = new Map<string, Uint8Array>();
  const artifacts = {
    put: vi.fn(async (content: Uint8Array) => {
      const digest = createHash("sha256").update(content).digest("hex");
      const uri = `memory://sha256/${digest}`;
      bytes.set(uri, content.slice());
      return {
        uri,
        contentHash: `sha256:${digest}`,
        byteCount: content.byteLength,
        created: true,
      };
    }),
    get: vi.fn(async (uri: string) => bytes.get(uri)!.slice()),
  };
  const store: HubCommandAuthoringStore = {
    async findAuthorship() { return record === null ? null : structuredClone(record); },
    async commitAuthorship(input) {
      if (record !== null) return { status: "duplicate", record: structuredClone(record) };
      record = structuredClone(input);
      return { status: "created", record: structuredClone(input) };
    },
    async findLeasedArtifact() { return null; },
  };
  const keys = generateKeyPairSync("ed25519");
  const signer = {
    keyId: "key_authoring_test_01",
    sign(command: RemoteCommand) {
      return createSignedRemoteCommandEnvelope({
        command,
        keyId: this.keyId,
        signature: sign(null, remoteCommandSigningBytes({ command, keyId: this.keyId }), keys.privateKey),
      });
    },
  };
  return { artifacts, store, signer };
}

describe("Hub command authoring", () => {
  it("owns command time and nonce while returning the exact original on a retry", async () => {
    const setup = fixture();
    const input = {
      ...setup,
      destinationId,
      target,
      principalId: "operator:authoring-test",
      authoredAt: "2026-08-22T00:00:00.000Z",
      request,
      nonce: () => Buffer.alloc(32, 7).toString("base64url"),
    };

    const first = await authorHubCommand(input);
    const retry = await authorHubCommand({ ...input, nonce: () => { throw new Error("retry nonce"); } });

    expect(first.status).toBe("created");
    expect(retry).toEqual({ status: "duplicate", record: first.record });
    expect(first.record.envelope.command).toMatchObject({
      issuedAt: "2026-08-22T00:00:00.000Z",
      expiresAt: "2026-08-22T00:02:00.000Z",
      nonce: Buffer.alloc(32, 7).toString("base64url"),
    });
    expect(first.record.artifactRetainUntil).toBe("2026-09-21T00:00:00.000Z");
    expect(setup.artifacts.put).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(first.record)).not.toContain(request.request);
  });

  it("rejects changed content before writing another artifact", async () => {
    const setup = fixture();
    const common = {
      ...setup,
      destinationId,
      target,
      principalId: "operator:authoring-test",
      authoredAt: "2026-08-22T00:00:00.000Z",
      nonce: () => Buffer.alloc(32, 8).toString("base64url"),
    };
    await authorHubCommand({ ...common, request });

    await expect(authorHubCommand({
      ...common,
      request: { ...request, request: "내용이 바뀐 요청" },
    })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(setup.artifacts.put).toHaveBeenCalledTimes(2);
  });

  it("does not allow artifact retention shorter than command lifetime", async () => {
    const setup = fixture();
    await expect(authorHubCommand({
      ...setup,
      destinationId,
      target,
      principalId: "operator:authoring-test",
      authoredAt: "2026-08-22T00:00:00.000Z",
      request,
      artifactRetentionMs: 60_000,
    })).rejects.toMatchObject({ code: "invalid_request" });
    expect(setup.artifacts.put).not.toHaveBeenCalled();
  });
});
