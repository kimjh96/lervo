import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createLiveWebhookSignature } from "@lervo/adapter-webhook";
import { listAssignments } from "@lervo/agent-workforce";
import type { LiveWebhookAuthorizationV1 } from "@lervo/live-trigger-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { resolveRoleContract } from "@lervo/roles";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

function io(root: string, onStdout: (value: string) => void = () => undefined) {
  return { cwd: root, stdout: onStdout, stderr: () => undefined };
}

async function startWorkstream(root: string) {
  const draft = JSON.stringify({
    schemaVersion: 1,
    status: "active",
    title: "Live trigger",
    objective: "Prove an authenticated live trigger.",
    nextActions: [],
    blockers: [],
    notes: [],
    references: [],
    pendingDecisions: [],
    pendingApprovals: [],
    updatedAt: new Date().toISOString(),
  });
  let output = "";
  expect(
    await runCli(["workstream", "start", "--stdin", "--json"], {
      ...io(root, (value) => {
        output += value;
      }),
      stdin: async () => draft,
    }),
  ).toBe(0);
  const plan = JSON.parse(output) as { planId: string; snapshot: { workstreamId: string } };
  expect(
    await runCli(["workstream", "start", "--stdin", "--apply", plan.planId], {
      ...io(root),
      stdin: async () => draft,
    }),
  ).toBe(0);
  return plan.snapshot.workstreamId;
}

async function serveOnce(
  root: string,
  configPath: string,
): Promise<{ port: number; result: Promise<number> }> {
  let ready!: (port: number) => void;
  const listening = new Promise<number>((resolveReady) => {
    ready = resolveReady;
  });
  const result = runCli(
    ["trigger", "webhook", "serve", "--config", configPath, "--once", "--json"],
    io(root, (value) => {
      const parsed = JSON.parse(value) as { status: string; port: number };
      if (parsed.status === "listening") ready(parsed.port);
    }),
  );
  return { port: await listening, result };
}

describe("live trigger command", () => {
  it("accepts one signed HTTP event and returns current on exact replay", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-live-trigger-cli-"));
    roots.push(root);
    expect(await runCli(["init"], io(root))).toBe(0);
    const workstreamId = await startWorkstream(root);
    const role = await resolveRoleContract(root, "developer");
    const storage = await openProjectStorage(root);
    const projectId = storage.manifest.projectId;
    await storage.close();
    const authorization: LiveWebhookAuthorizationV1 = {
      schemaVersion: 1,
      kind: "lervo_live_webhook_authorization",
      adapterId: "lervo.webhook.hmac-sha256",
      adapterVersion: "1.0.0",
      projectId,
      workstreamId,
      sourceId: "github.primary",
      credentialId: "github.webhook",
      acceptedEventTypes: ["issue.updated"],
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      maximumAcceptedTriggers: 1,
      routine: {
        schemaVersion: 1,
        routineId: "issue.triage",
        templateVersion: "1.0.0",
        concurrency: { mode: "enqueue_bounded", maximumActiveInstances: 1 },
        nodes: [
          {
            nodeKey: "triage",
            taskType: "issue.triage",
            roleId: "developer",
            roleVersion: role.version,
            roleContractHash: role.contractHash,
            requiredCapabilityHash: null,
            priority: 60,
            dependencyNodeKeys: [],
            acceptanceCriteria: ["Triage the authorized issue event."],
            verificationSuiteIds: ["project.quick"],
            approvalRequirements: [],
            expectedPaths: ["src/issue.ts"],
          },
        ],
      },
    };
    const authorizationPath = resolve(root, ".lervo/live-webhook-authorization.json");
    const configPath = resolve(root, "live-webhook-config.json");
    await writeFile(authorizationPath, `${JSON.stringify(authorization)}\n`, { mode: 0o600 });
    await writeFile(
      configPath,
      `${JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: ".",
        authorizationFile: ".lervo/live-webhook-authorization.json",
        listen: { host: "127.0.0.1", port: 0, path: "/hooks/issues" },
        credential: {
          credentialId: "github.webhook",
          secretEnvironmentVariable: "LERVO_TEST_WEBHOOK_SECRET",
        },
      })}\n`,
      { mode: 0o600 },
    );
    await chmod(authorizationPath, 0o600);
    await chmod(configPath, 0o600);
    const secret = "01234567890123456789012345678901";
    process.env.LERVO_TEST_WEBHOOK_SECRET = secret;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = Buffer.from('{"private":"never persisted"}', "utf8");
    const headers = {
      "x-lervo-timestamp": timestamp,
      "x-lervo-event-id": "github-event-1",
      "x-lervo-event-type": "issue.updated",
      "x-lervo-signature": createLiveWebhookSignature({
        secret: Buffer.from(secret),
        timestamp,
        eventId: "github-event-1",
        eventType: "issue.updated",
        body,
      }),
    };
    try {
      const firstServer = await serveOnce(root, configPath);
      const first = await fetch(`http://127.0.0.1:${firstServer.port}/hooks/issues`, {
        method: "POST",
        headers,
        body,
      });
      const firstBody = await first.json();
      expect(first.status, JSON.stringify(firstBody)).toBe(202);
      expect(firstBody).toMatchObject({
        status: "accepted",
        completion: { disposition: "materialized" },
      });
      expect(await firstServer.result).toBe(0);
      expect(await listAssignments(root)).toHaveLength(1);

      const replayServer = await serveOnce(root, configPath);
      const replay = await fetch(`http://127.0.0.1:${replayServer.port}/hooks/issues`, {
        method: "POST",
        headers,
        body,
      });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ status: "current" });
      expect(await replayServer.result).toBe(0);
      expect(await listAssignments(root)).toHaveLength(1);
    } finally {
      delete process.env.LERVO_TEST_WEBHOOK_SECRET;
    }
  });
});
