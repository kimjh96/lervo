import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { HubControlReviewGrants } from "@lervo/hub-control";
import {
  authorPolicySnapshot,
} from "@lervo/hub-policy";
import { handleProjectRegistration, handleRemoteCommandEnqueue } from "@lervo/hub-sync";
import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { Ed25519PolicySigner } from "@lervo/policy";
import { Ed25519RemoteCommandSigner } from "@lervo/remote-command";
import { createRemoteCommand } from "@lervo/remote-command-contract";
import { defaultProjectDataPolicy, type ProjectManifest } from "@lervo/schemas";
import {
  calculateProjectIdentityHash,
  createProjectRegistrationRequest,
} from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import { ConfiguredBearerAuthenticator, createHubServer } from "../src/index.js";
import { traceSource } from "./http-fixture.js";

const destinationId = "hub:control-http";
const reviewerToken = "hub-control-reviewer-token-aaaaaaaaaaaaaaaaaaaa";
const readerToken = "hub-control-reader-token-bbbbbbbbbbbbbbbbbbbbbb";
const otherToken = "hub-control-other-token-ccccccccccccccccccccccc";
const hubIdentityHash = `sha256:${"9".repeat(64)}`;
const roots: string[] = [];
const stores: HubSyncSQLiteStore[] = [];
const servers: ReturnType<typeof createHubServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done, reject) =>
    server.close((error) => error === undefined ? done() : reject(error))
  )));
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function manifest(): ProjectManifest {
  return {
    schemaVersion: 1,
    projectId: "prj_control_http_01",
    name: "Control HTTP fixture",
    root: ".",
    createdAt: "2026-08-20T00:00:00.000Z",
    dataPolicy: { ...defaultProjectDataPolicy, hubSyncEnabled: true },
  };
}

function post(token: string, body: unknown) {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

describe("Hub command approval control", () => {
  it("requires the bound principal to review and a separate approval write to create signed approval", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-control-http-"));
    roots.push(root);
    const store = await HubSyncSQLiteStore.open({ path: resolve(root, "hub.sqlite") });
    stores.push(store);
    const project = manifest();
    const projectIdentityHash = calculateProjectIdentityHash(project);
    const target = { projectId: project.projectId, projectIdentityHash };
    await handleProjectRegistration({
      store,
      request: createProjectRegistrationRequest({
        manifest: project,
        destinationId,
        requestedAt: "2026-08-20T00:00:00.000Z",
      }),
      acceptedAt: "2026-08-20T00:00:00.000Z",
    });

    const commandKeys = generateKeyPairSync("ed25519");
    const command = createRemoteCommand({
      idempotencyKey: "idk_control_http_approval_01",
      nonce: Buffer.alloc(32, 8).toString("base64url"),
      issuedAt: "2026-08-20T00:00:00.000Z",
      expiresAt: "2026-08-20T01:00:00.000Z",
      target,
      action: {
        kind: "managed_run",
        roleId: "developer",
        provider: "codex",
        risk: "medium",
        verificationSuiteIds: ["repo.check"],
        request: {
          artifactId: "art_secret_request_not_for_review",
          contentHash: `sha256:${"a".repeat(64)}`,
          byteCount: 32,
          mediaType: "text/plain; charset=utf-8",
        },
      },
    });
    const queued = await handleRemoteCommandEnqueue({
      store,
      destinationId,
      envelope: new Ed25519RemoteCommandSigner("key_control_command_01", commandKeys.privateKey)
        .sign(command),
      queuedAt: "2026-08-20T00:00:01.000Z",
    });

    const policyKeys = generateKeyPairSync("ed25519");
    const policySigner = new Ed25519PolicySigner("key_control_policy_01", policyKeys.privateKey);
    await authorPolicySnapshot({
      store,
      signer: policySigner,
      request: {
        destinationId,
        target,
        rules: [{
          ruleId: "polr_control_write",
          roleId: "developer",
          risk: "medium",
          capability: "filesystem.write",
          repositoryPaths: ["src/result.ts"],
          decision: "require_approval",
        }, {
          ruleId: "polr_control_shell",
          roleId: "developer",
          risk: "medium",
          capability: "shell.execute",
          repositoryPaths: ["scripts/check.sh"],
          decision: "require_approval",
        }],
        issuedAt: "2026-08-20T00:01:00.000Z",
        expiresAt: "2026-08-20T00:50:00.000Z",
        publishedAt: "2026-08-20T00:01:00.000Z",
      },
    });

    const authenticator = new ConfiguredBearerAuthenticator([
      {
        token: reviewerToken,
        principalId: "operator:reviewer",
        permissions: ["command.read", "approval.write"],
        projects: [{ destinationId, projectId: project.projectId }],
      },
      {
        token: readerToken,
        principalId: "operator:reader",
        permissions: ["command.read"],
        projects: [{ destinationId, projectId: project.projectId }],
      },
      {
        token: otherToken,
        principalId: "operator:someone-else",
        permissions: ["command.read", "approval.write"],
        projects: [{ destinationId, projectId: project.projectId }],
      },
    ]);
    const grants = new HubControlReviewGrants(Buffer.alloc(32, 5), { ttlSeconds: 600 });
    const grant = grants.issue({
      principalId: "operator:reviewer",
      destinationId,
      projectId: project.projectId,
      deliveryId: queued.deliveryId,
      issuedAt: "2026-08-20T00:04:00.000Z",
    });
    const server = createHubServer({
      trace: { authenticator, source: traceSource() },
      control: {
        authenticator,
        source: store,
        reviewGrants: grants,
        now: () => new Date("2026-08-20T00:05:00.000Z"),
      },
      policy: {
        authenticator,
        store,
        signer: policySigner,
        hubIdentityHash,
        now: () => new Date("2026-08-20T00:05:00.000Z"),
      },
    });
    servers.push(server);
    await new Promise<void>((done, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", done);
    });
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const reviewUrl = new URL(
      `/v1/control/projects/${project.projectId}/commands/${queued.deliveryId}`,
      base,
    );
    reviewUrl.searchParams.set("destinationId", destinationId);

    expect((await fetch(reviewUrl, {
      headers: { authorization: `Bearer ${reviewerToken}` },
    })).status).toBe(403);
    expect((await fetch(reviewUrl, {
      headers: {
        authorization: `Bearer ${otherToken}`,
        "x-lervo-control-review": grant,
      },
    })).status).toBe(403);

    const reviewResponse = await fetch(reviewUrl, {
      headers: {
        authorization: `Bearer ${reviewerToken}`,
        "x-lervo-control-review": grant,
      },
    });
    expect(reviewResponse.status).toBe(200);
    const initialReview = await reviewResponse.json() as {
      projectIdentityHash: string;
      delivery: { commandId: string };
      approval: { state: string; options: unknown[]; maximumExpiresAt: string };
    };
    expect(initialReview.approval).toMatchObject({
      state: "approval_required",
      maximumExpiresAt: "2026-08-20T00:50:00.000Z",
    });
    expect(initialReview.approval.options).toHaveLength(2);
    const serialized = JSON.stringify(initialReview);
    expect(serialized).not.toContain("art_secret_request_not_for_review");
    expect(serialized).not.toContain("commandHash");
    expect(serialized).not.toContain("signature");
    expect(serialized).not.toContain("approverSubjectHash");

    const bundleBefore = await store.pullPolicyBundle({
      destinationId,
      target,
      currentSnapshotId: null,
    });
    expect(bundleBefore?.approvals).toHaveLength(0);
    const approvalUrl = new URL(`/v1/policy/projects/${project.projectId}/approvals`, base);
    approvalUrl.searchParams.set("destinationId", destinationId);
    approvalUrl.searchParams.set("projectIdentityHash", projectIdentityHash);
    const approvalBody = {
      schemaVersion: 1,
      commandId: initialReview.delivery.commandId,
      capability: "filesystem.write",
      repositoryPaths: ["src/result.ts"],
      expiresAt: initialReview.approval.maximumExpiresAt,
    };
    expect((await fetch(approvalUrl, post(readerToken, approvalBody))).status).toBe(403);
    expect((await store.pullPolicyBundle({
      destinationId,
      target,
      currentSnapshotId: null,
    }))?.approvals).toHaveLength(0);

    const firstApprovalResponse = await fetch(approvalUrl, post(reviewerToken, approvalBody));
    expect(firstApprovalResponse.status).toBe(201);
    const firstApproval = await firstApprovalResponse.json() as {
      result: { originalId: string };
    };
    expect((await store.pullPolicyBundle({
      destinationId,
      target,
      currentSnapshotId: null,
    }))?.approvals).toHaveLength(1);
    const partialResponse = await fetch(reviewUrl, {
      headers: {
        authorization: `Bearer ${reviewerToken}`,
        "x-lervo-control-review": grant,
      },
    });
    expect((await partialResponse.json() as { approval: { state: string } }).approval.state)
      .toBe("partially_approved");

    const secondApprovalResponse = await fetch(approvalUrl, post(reviewerToken, {
      ...approvalBody,
      capability: "shell.execute",
      repositoryPaths: ["scripts/check.sh"],
    }));
    expect(secondApprovalResponse.status).toBe(201);
    const approvedResponse = await fetch(reviewUrl, {
      headers: {
        authorization: `Bearer ${reviewerToken}`,
        "x-lervo-control-review": grant,
      },
    });
    expect((await approvedResponse.json() as { approval: { state: string } }).approval.state)
      .toBe("approved");

    const revocationUrl = new URL(`/v1/policy/projects/${project.projectId}/revocations`, base);
    revocationUrl.searchParams.set("destinationId", destinationId);
    revocationUrl.searchParams.set("projectIdentityHash", projectIdentityHash);
    expect((await fetch(revocationUrl, post(reviewerToken, {
      schemaVersion: 1,
      approvalId: firstApproval.result.originalId,
      reasonCode: "security_policy_changed",
    }))).status).toBe(201);
    const revokedResponse = await fetch(reviewUrl, {
      headers: {
        authorization: `Bearer ${reviewerToken}`,
        "x-lervo-control-review": grant,
      },
    });
    expect(await revokedResponse.json()).toMatchObject({
      approval: { state: "partially_approved", hadRevokedApproval: true },
    });
  });
});
