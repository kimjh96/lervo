import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import type { ConversationAdapter } from "@lervo/conversation-contract";
import type { RemoteCommandDeliveryAcknowledgement, RemoteCommandLease } from "@lervo/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationResultRuntime } from "../src/conversation-result-runtime.js";
import { SQLiteConversationResultStore } from "../src/conversation-result-store.js";
import type { ConversationResultOrigin } from "../src/conversation-result-types.js";

const roots: string[] = [];
const origin: ConversationResultOrigin = {
  deliveryId: `rcd_${"1".repeat(64)}`,
  commandId: `rcm_${"2".repeat(64)}`,
  sourceEventId: `cve_${"3".repeat(64)}`,
  target: {
    integrationId: "itg_discordresult",
    projectId: "prj_resulttest",
    conversationId: "cnv_resulttest",
    threadId: "thd_resulttest",
  },
  policyId: `cpp_${"4".repeat(64)}`,
  agentParticipantId: "ptc_resultagent",
  roleId: "developer",
  provider: "codex",
  workstreamId: `wks_${"5".repeat(24)}`,
  workstreamRevision: 8,
  workstreamSnapshotContentHash: `sha256:${"6".repeat(64)}`,
  assignmentId: `asn_${"7".repeat(24)}`,
  agentId: `agt_${"8".repeat(24)}`,
  queuedAt: "2026-09-07T08:00:00.000Z",
};

function acknowledgement(lease = "a"): RemoteCommandDeliveryAcknowledgement {
  return {
    schemaVersion: 1,
    deliveryId: origin.deliveryId,
    leaseId: `rcl_${lease.repeat(43)}`,
    commandId: origin.commandId,
    commandHash: `sha256:${"9".repeat(64)}`,
    acknowledgedAt: "2026-09-07T08:00:02.000Z",
    disposition: "completed",
    receipt: {
      schemaVersion: 1,
      commandId: origin.commandId,
      commandHash: `sha256:${"9".repeat(64)}`,
      idempotencyKey: "idk_result_runtime_01",
      processedAt: "2026-09-07T08:00:01.000Z",
      outcome: "executed",
      runId: "run_result_runtime_01",
    },
  };
}

function commandLease(lease = "a"): RemoteCommandLease {
  return {
    schemaVersion: 1,
    deliveryId: origin.deliveryId,
    leaseId: `rcl_${lease.repeat(43)}`,
    leasedTo: "node_result_runtime",
    leasedAt: "2026-09-07T08:00:00.000Z",
    leaseExpiresAt: "2026-09-07T08:01:00.000Z",
    envelope: {
      schemaVersion: 1,
      command: {
        schemaVersion: 1,
        commandId: origin.commandId,
        idempotencyKey: "idk_result_runtime_01",
        nonce: "n".repeat(43),
        issuedAt: "2026-09-07T08:00:00.000Z",
        expiresAt: "2026-09-07T08:01:00.000Z",
        target: {
          projectId: origin.target.projectId,
          projectIdentityHash: `sha256:${"e".repeat(64)}`,
        },
        action: {
          kind: "managed_run",
          roleId: origin.roleId,
          provider: origin.provider,
          risk: "medium",
          verificationSuiteIds: ["repo.check"],
          request: {
            artifactId: "art_result_request",
            contentHash: `sha256:${"f".repeat(64)}`,
            byteCount: 12,
            mediaType: "text/plain; charset=utf-8",
          },
          continuation: {
            workstreamId: origin.workstreamId,
            revision: origin.workstreamRevision,
            snapshotContentHash: origin.workstreamSnapshotContentHash,
            assignmentId: origin.assignmentId,
            agentId: origin.agentId,
          },
        },
      },
      signature: {
        algorithm: "ed25519",
        keyId: "key_result_runtime",
        value: "s".repeat(86),
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conversation execution result runtime", () => {
  it.each([
    { content: "The requested change is complete.", retry: false },
    { content: "현재 자료에서는 두 방식의 차이를 확인했습니다.", retry: false },
    { content: "A".repeat(2000), retry: false },
    { content: "The result remains available while delivery is retried.", retry: true },
  ])(
    "delivers contextual result bytes across recovery (retry: $retry)",
    async ({ content: resultText, retry }) => {
      const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-result-"));
      roots.push(root);
      const path = resolve(root, "results.sqlite");
      const artifacts = await FileSystemCas.open(resolve(root, "artifacts"));
      let store = await SQLiteConversationResultStore.open(path);
      await expect(store.register(origin)).resolves.toBe("created");
      await expect(
        store.observeTerminal({
          lease: commandLease(),
          terminal: {
            acknowledgement: acknowledgement(),
            observedAt: "2026-09-07T08:00:02.000Z",
          },
        }),
      ).resolves.toBe("ready");
      store.close();

      store = await SQLiteConversationResultStore.open(path);
      const delivered = vi.fn<ConversationAdapter["deliver"]>(async (outbound) => ({
        schemaVersion: 1,
        outboundId: outbound.outboundId,
        integrationId: outbound.target.integrationId,
        deliveryKeyHash: `sha256:${"b".repeat(64)}`,
        deliveredAt: "2026-09-07T08:00:05.000Z",
      }));
      const sourceRead = vi.fn(async ({ runId }: { runId: string }) => ({
        runId,
        content: resultText,
      }));
      let evaluationCount = 0;
      let clock = "2026-09-07T08:00:04.000Z";
      const makeRuntime = () =>
        new ConversationResultRuntime({
          workerId: "result-worker",
          store,
          artifacts,
          adapter: {
            descriptor: {
              schemaVersion: 1,
              integrationId: origin.target.integrationId,
              adapterKind: "discord",
              instanceIdentityHash: `sha256:${"c".repeat(64)}`,
              capabilities: ["messages.send"],
            },
            deliver: delivered,
          },
          source: {
            read: sourceRead,
          },
          semanticEvaluator: {
            evaluate: async (request) => {
              evaluationCount++;
              return {
                evaluator: { kind: "model", evaluatorId: "test.semantic-writing" },
                checks: request.checks.map((check) => ({
                  checkId: check.checkId,
                  status: "passed" as const,
                  violationCount: 0,
                })),
              };
            },
          },
          now: () => new Date(clock),
        });

      let runtime = makeRuntime();
      if (retry) {
        delivered.mockRejectedValueOnce(new Error("transport_unavailable"));
        await expect(runtime.runCycle()).resolves.toMatchObject({ status: "retry_scheduled" });
        expect(sourceRead).toHaveBeenCalledTimes(1);
        expect(evaluationCount).toBe(1);
        runtime.close();
        store = await SQLiteConversationResultStore.open(path);
        clock = "2026-09-07T08:00:10.000Z";
        runtime = makeRuntime();
      }
      await expect(runtime.runCycle()).resolves.toMatchObject({
        status: "delivered",
        deliveryId: origin.deliveryId,
      });
      await expect(runtime.runCycle()).resolves.toEqual({ status: "idle" });
      expect(delivered).toHaveBeenCalledTimes(retry ? 2 : 1);
      expect(sourceRead).toHaveBeenCalledTimes(1);
      expect(evaluationCount).toBe(1);
      if (retry) expect(delivered.mock.calls[1]![0]).toEqual(delivered.mock.calls[0]![0]);
      const outbound = delivered.mock.calls[0]![0];
      const bytes = await artifacts.get(
        `lervo-cas://sha256/${outbound.content.contentHash.slice("sha256:".length)}`,
      );
      const content = new TextDecoder().decode(bytes);
      expect(content).toBe(resultText);
      expect(content).not.toContain(origin.deliveryId);
      expect(content).not.toContain("run_result_runtime_01");
      expect(content).not.toContain(origin.assignmentId);
      await expect(
        runtime.observe({ lease: commandLease("d"), acknowledgement: acknowledgement("d") }),
      ).resolves.toBe("duplicate");
      runtime.close();
    },
  );
});
