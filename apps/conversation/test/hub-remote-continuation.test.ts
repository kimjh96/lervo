import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { SignedRemoteCommand } from "@lervo/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  HubConversationRemoteContinuation,
  HubWorkstreamContinuationResolver,
  type HubRemoteCommandSubmissionPort,
} from "../src/index.js";

const target = {
  projectId: "prj_remote001",
  projectIdentityHash: `sha256:${"1".repeat(64)}`,
};
const continuation = {
  workstreamId: `wks_${"2".repeat(24)}`,
  revision: 23,
  snapshotContentHash: `sha256:${"3".repeat(64)}`,
  assignmentId: `asn_${"4".repeat(24)}`,
  agentId: `agt_${"5".repeat(24)}`,
};
const source = {
  projectId: target.projectId,
  conversationId: "cnv_remote001",
  threadId: "thd_remote001",
  eventId: `cevt_${"6".repeat(64)}`,
  participantId: "ptc_operator01",
  request: "Continue the current assignment and verify the result.",
  requestContentHash: "",
  requestedAt: "2026-09-07T09:00:00.000Z",
};
source.requestContentHash = `sha256:${createHash("sha256").update(source.request).digest("hex")}`;

function response(
  request: Parameters<HubRemoteCommandSubmissionPort["submit"]>[0],
): Awaited<ReturnType<HubRemoteCommandSubmissionPort["submit"]>> {
  return {
    status: "created",
    destinationId: "hub:discord-remote",
    target,
    deliveryId: `rcd_${"7".repeat(64)}`,
    queuedAt: source.requestedAt,
    envelope: {
      schemaVersion: 1,
      command: {
        schemaVersion: 1,
        commandId: `rcm_${"8".repeat(64)}`,
        idempotencyKey: request.idempotencyKey,
        nonce: Buffer.alloc(32, 9).toString("base64url"),
        issuedAt: source.requestedAt,
        expiresAt: "2026-09-07T09:02:00.000Z",
        target,
        action: {
          kind: "managed_run",
          roleId: request.roleId,
          provider: request.provider,
          risk: request.risk,
          verificationSuiteIds: request.verificationSuiteIds,
          request: {
            artifactId: "art_remote_request01",
            contentHash: source.requestContentHash,
            byteCount: Buffer.byteLength(source.request),
            mediaType: "text/plain; charset=utf-8",
          },
          continuation: request.continuation,
        },
      },
      signature: {
        algorithm: "ed25519",
        keyId: "key_remote_request01",
        value: Buffer.alloc(64, 10).toString("base64url"),
      },
    } as SignedRemoteCommand,
  };
}

function fixture() {
  const submit = vi.fn<HubRemoteCommandSubmissionPort["submit"]>(async (request) =>
    response(request),
  );
  const resolveContinuation = vi.fn(async () => continuation);
  const remote = new HubConversationRemoteContinuation({
    target,
    destinationId: "hub:discord-remote",
    conversationIds: [source.conversationId],
    participantIds: [source.participantId],
    roleId: "developer",
    provider: "codex",
    risk: "medium",
    verificationSuiteIds: ["repo.check"],
    lifetimeMs: 120_000,
    submission: { submit },
    resolveContinuation,
  });
  return { remote, submit, resolveContinuation };
}

describe("Hub conversation remote continuation", () => {
  it("binds one Discord event to one exact workstream command", async () => {
    const { remote, submit } = fixture();

    const first = await remote.request(source);
    const retry = await remote.request(source);

    expect(first).toEqual({
      status: "queued",
      deliveryId: `rcd_${"7".repeat(64)}`,
      provider: "codex",
      roleId: "developer",
      workstreamId: continuation.workstreamId,
      workstreamRevision: continuation.revision,
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]![0].idempotencyKey).toBe(submit.mock.calls[1]![0].idempotencyKey);
    expect(submit.mock.calls[0]![0]).toMatchObject({
      request: source.request,
      continuation,
    });
    expect(retry.deliveryId).toBe(first.deliveryId);
  });

  it("rejects a participant outside the explicit conversation scope", async () => {
    const { remote, submit, resolveContinuation } = fixture();

    await expect(remote.request({ ...source, participantId: "ptc_intruder01" })).rejects.toThrow(
      "outside the configured scope",
    );
    expect(resolveContinuation).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects request bytes that differ from the Discord artifact hash", async () => {
    const { remote, submit, resolveContinuation } = fixture();

    await expect(
      remote.request({ ...source, request: `${source.request} changed` }),
    ).rejects.toThrow("source evidence is invalid");
    expect(resolveContinuation).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects Hub-authored command drift", async () => {
    const setup = fixture();
    setup.submit.mockImplementationOnce(async (request) => {
      const result = response(request);
      result.envelope.command.action.provider = "claude";
      return result;
    });

    await expect(setup.remote.request(source)).rejects.toThrow(
      "differs from the conversation request binding",
    );
  });
});

describe("Hub workstream continuation resolver", () => {
  it("returns the one authenticated active Hub head", async () => {
    const snapshot = {
      schemaVersion: 1 as const,
      workstreamId: continuation.workstreamId,
      revision: continuation.revision,
      status: "active" as const,
      title: "Discord continuation",
      objective: "Continue the same repository workstream from Discord.",
      nextActions: ["Run the requested task."],
      blockers: [],
      notes: [],
      references: [],
      pendingDecisions: [],
      pendingApprovals: [],
      origin: {
        kind: "created" as const,
        sourceArtifactId: null,
        sourceContentHash: null,
        sourcePathDigest: null,
      },
      updatedAt: source.requestedAt,
    };
    const resolver = new HubWorkstreamContinuationResolver({
      target,
      destinationId: "hub:discord-remote",
      expectedHubIdentityHash: `sha256:${"9".repeat(64)}`,
      assignmentId: continuation.assignmentId,
      agentId: continuation.agentId,
      transport: {
        async readWorkstream() {
          return {
            authentication: {
              status: "verified",
              destinationId: "hub:discord-remote",
              peerIdentityHash: `sha256:${"9".repeat(64)}`,
            },
            body: {
              schemaVersion: 1,
              status: "current",
              projectId: target.projectId,
              repositoryIdentityHash: target.projectIdentityHash,
              heads: [
                {
                  workstreamId: continuation.workstreamId,
                  revision: continuation.revision,
                  status: "active",
                  snapshotContentHash: `sha256:${createHash("sha256")
                    .update(`${canonicalJson(snapshot)}\n`)
                    .digest("hex")}`,
                  previousSnapshotContentHash: `sha256:${"a".repeat(64)}`,
                  publishedAt: source.requestedAt,
                },
              ],
              snapshot,
            },
          };
        },
      },
    });

    await expect(resolver.resolve()).resolves.toEqual({
      ...continuation,
      snapshotContentHash: `sha256:${createHash("sha256")
        .update(`${canonicalJson(snapshot)}\n`)
        .digest("hex")}`,
    });
  });
});
