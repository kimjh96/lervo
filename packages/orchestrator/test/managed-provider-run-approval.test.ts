import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createRemoteCommand } from "@lervo/remote-command-contract";
import type { ManagedRunApprovalAuthorization } from "@lervo/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManagedCapabilityApprovalVerifier } from "../src/index.js";
import {
  cleanupManagedFixtures,
  createManagedFixture,
  providerRunInput,
  role,
  runId,
  targetDigest,
} from "./fixture.js";
import { coordinator } from "./managed-provider-run-test-harness.js";
import { FakeManagedAdapter } from "./provider-run-fake-adapter.js";

function approvalAuthorization(): ManagedRunApprovalAuthorization {
  return {
    schemaVersion: 1,
    source: "remote_command",
    command: createRemoteCommand({
      idempotencyKey: "idk_orchestrator_approval_01",
      nonce: Buffer.alloc(32, 7).toString("base64url"),
      issuedAt: "2026-08-18T00:55:00.000Z",
      expiresAt: "2026-08-18T02:00:00.000Z",
      target: {
        projectId: "prj_orchestrator_01",
        projectIdentityHash: `sha256:${"c".repeat(64)}`,
      },
      action: {
        kind: "managed_run",
        roleId: role.roleId,
        provider: "codex",
        risk: "low",
        verificationSuiteIds: ["test.fixture"],
        request: {
          artifactId: "art_orchestrator_approval_request",
          contentHash: targetDigest,
          byteCount: 42,
          mediaType: "text/plain; charset=utf-8",
        },
      },
    }),
    commandSignerKeyId: "key_remote_orchestrator",
    policySnapshotId: `pol_${"d".repeat(64)}`,
    approvalIds: [`apr_${"e".repeat(64)}`],
  };
}

afterEach(cleanupManagedFixtures);

describe("managed provider approval", () => {
  it("does not start a provider when require_approval evidence is absent", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    const input = providerRunInput();

    await expect(
      coordinator(adapter, data.root, data.store).run({
        ...input,
        repositoryRoot: data.root,
        context: {
          ...input.context,
          role: {
            ...role,
            capabilities: { ...role.capabilities, "filesystem.write": "require_approval" },
          },
        },
      }),
    ).rejects.toMatchObject({ code: "approval_required" });

    expect(adapter.calls).toEqual([]);
    expect(data.store.list({ runId }).at(-1)).toMatchObject({
      type: "run.failed",
      payload: { failureCode: "approval_required", retryable: false },
    });
    data.store.close();
  });

  it("rejects verifier evidence outside the supplied authorization", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex");
    const authorization = approvalAuthorization();
    const input = providerRunInput();

    await expect(
      coordinator(adapter, data.root, data.store, undefined, undefined, {
        verify: async () => ({
          approved: true,
          approvalId: `apr_${"f".repeat(64)}`,
          policySnapshotId: authorization.policySnapshotId,
        }),
      }).run({
        ...input,
        repositoryRoot: data.root,
        approvalAuthorization: authorization,
        context: {
          ...input.context,
          role: {
            ...role,
            capabilities: { ...role.capabilities, "filesystem.write": "require_approval" },
          },
        },
      }),
    ).rejects.toMatchObject({ code: "approval_required" });

    expect(adapter.calls).toEqual([]);
    data.store.close();
  });

  it("rechecks signed approval at write time and issues an evidenced one-write permit", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex", {
      managedWrite: {
        path: "src/result.ts",
        targetDigest,
        changeKind: "created",
        apply: () => writeFile(resolve(data.root, "src/result.ts"), "approved\n"),
      },
    });
    const authorization = approvalAuthorization();
    const verify = vi.fn(
      async (_input: Parameters<ManagedCapabilityApprovalVerifier["verify"]>[0]) => ({
        approved: true as const,
        approvalId: authorization.approvalIds[0]!,
        policySnapshotId: authorization.policySnapshotId,
      }),
    );
    const input = providerRunInput();
    const result = await coordinator(adapter, data.root, data.store, undefined, undefined, {
      verify,
    }).run({
      ...input,
      repositoryRoot: data.root,
      approvalAuthorization: authorization,
      context: {
        ...input.context,
        role: {
          ...role,
          capabilities: { ...role.capabilities, "filesystem.write": "require_approval" },
        },
      },
    });

    expect(result.managedChanges).toEqual([
      expect.objectContaining({ path: "src/result.ts", changeKind: "created" }),
    ]);
    expect(result.session.executionMode).toBe("managed_write");
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls.map(([call]) => call.requestedPath)).toEqual([null, "src/result.ts"]);
    expect(
      data.store.list({ runId }).find((event) => event.type === "capability.decided")?.payload,
    ).toMatchObject({
      decision: "allow",
      approvalId: authorization.approvalIds[0],
      policyRuleId: "managed_context_e3+signed_approval",
    });
    data.store.close();
  });

  it("fails closed when approval becomes invalid after preflight but before write", async () => {
    const data = await createManagedFixture();
    const adapter = new FakeManagedAdapter("codex", {
      managedWrite: {
        path: "src/result.ts",
        targetDigest,
        changeKind: "created",
        apply: () => writeFile(resolve(data.root, "src/result.ts"), "must not run\n"),
      },
    });
    const authorization = approvalAuthorization();
    let calls = 0;
    const verifier: ManagedCapabilityApprovalVerifier = {
      verify: async () =>
        ++calls === 1
          ? {
              approved: true,
              approvalId: authorization.approvalIds[0]!,
              policySnapshotId: authorization.policySnapshotId,
            }
          : { approved: false, reasonCode: "active_approval_missing" },
    };
    const input = providerRunInput();

    await expect(
      coordinator(adapter, data.root, data.store, undefined, undefined, verifier).run({
        ...input,
        repositoryRoot: data.root,
        approvalAuthorization: authorization,
        context: {
          ...input.context,
          role: {
            ...role,
            capabilities: { ...role.capabilities, "filesystem.write": "require_approval" },
          },
        },
      }),
    ).rejects.toMatchObject({ code: "provider_write_failed" });

    expect(calls).toBe(2);
    expect(
      data.store.list({ runId }).find((event) => event.type === "capability.decided")?.payload,
    ).toMatchObject({ decision: "require_approval", approvalId: null });
    await expect(access(resolve(data.root, "src/result.ts"))).rejects.toThrow();
    data.store.close();
  });
});
