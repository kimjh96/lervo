import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runInstalledCli } from "./installed-cli.mjs";

function parsed(result) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function signature(secret, timestamp, eventId, eventType, body) {
  return `v1=${createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.${eventId}.${eventType}.`), body]))
    .digest("hex")}`;
}

async function serveOnce(input) {
  const child = spawn(
    process.execPath,
    [input.cli, "trigger", "webhook", "serve", "--config", input.config, "--once", "--json"],
    { cwd: input.root, env: { ...process.env, LERVO_INSTALLED_WEBHOOK_SECRET: input.secret } },
  );
  const errors = [];
  child.stderr.on("data", (chunk) => errors.push(chunk));
  let output = "";
  const ready = await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(
      () => rejectReady(new Error("Installed webhook did not become ready.")),
      15_000,
    );
    child.once("error", rejectReady);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      resolveReady(JSON.parse(output.slice(0, newline)));
    });
  });
  const response = await fetch(`http://${ready.host}:${ready.port}${ready.path}`, {
    method: "POST",
    headers: input.headers,
    body: input.body,
  });
  const body = await response.json();
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", resolveExit);
  });
  assert.equal(exitCode, 0, Buffer.concat(errors).toString("utf8"));
  return { statusCode: response.status, body };
}

export async function verifyInstalledLiveWebhookTrigger(consumerRoot) {
  const cli = resolve(consumerRoot, "node_modules/@lervo/cli/dist/bin.js");
  const root = resolve(consumerRoot, "installed-live-webhook-trigger");
  await mkdir(root, { recursive: true });
  await runInstalledCli(cli, ["init", "--minimal", "--name", "installed-live-webhook"], root);
  const draftPath = resolve(root, "workstream.json");
  await writeFile(
    draftPath,
    `${JSON.stringify({
      schemaVersion: 1,
      status: "active",
      title: "Installed webhook acceptance",
      objective: "Prove a signed installed trigger with exact replay.",
      nextActions: [],
      blockers: [],
      notes: [],
      references: [],
      pendingDecisions: [],
      pendingApprovals: [],
      updatedAt: new Date().toISOString(),
    })}\n`,
  );
  const plan = parsed(
    await runInstalledCli(cli, ["workstream", "start", "--from", draftPath, "--json"], root),
  );
  const workstream = parsed(
    await runInstalledCli(
      cli,
      ["workstream", "start", "--from", draftPath, "--apply", plan.planId, "--json"],
      root,
    ),
  );
  const role = parsed(
    await runInstalledCli(cli, ["role", "show", "--role", "developer", "--json"], root),
  );
  const manifest = await readFile(resolve(root, ".lervo/project.yaml"), "utf8");
  const projectId = /^projectId: (prj_[a-f0-9]{16})$/mu.exec(manifest)?.[1];
  assert.notEqual(projectId, undefined);
  const authorizationPath = resolve(root, ".lervo/live-webhook-authorization.json");
  const configPath = resolve(root, "live-webhook-config.json");
  await writeFile(
    authorizationPath,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "lervo_live_webhook_authorization",
      adapterId: "lervo.webhook.hmac-sha256",
      adapterVersion: "1.0.0",
      projectId,
      workstreamId: workstream.workstreamId,
      sourceId: "installed.source",
      credentialId: "installed.webhook",
      acceptedEventTypes: ["change.ready"],
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      maximumAcceptedTriggers: 1,
      routine: {
        schemaVersion: 1,
        routineId: "installed.review",
        templateVersion: "1.0.0",
        concurrency: { mode: "enqueue_bounded", maximumActiveInstances: 1 },
        nodes: [
          {
            nodeKey: "review",
            taskType: "technical.review",
            roleId: "developer",
            roleVersion: role.version,
            roleContractHash: role.contractHash,
            requiredCapabilityHash: null,
            priority: 60,
            dependencyNodeKeys: [],
            acceptanceCriteria: ["Review the installed signed event."],
            verificationSuiteIds: ["project.quick"],
            approvalRequirements: [],
            expectedPaths: ["src/installed.ts"],
          },
        ],
      },
    })}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    configPath,
    `${JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: ".",
      authorizationFile: ".lervo/live-webhook-authorization.json",
      listen: { host: "127.0.0.1", port: 0, path: "/hooks/installed" },
      credential: {
        credentialId: "installed.webhook",
        secretEnvironmentVariable: "LERVO_INSTALLED_WEBHOOK_SECRET",
      },
    })}\n`,
    { mode: 0o600 },
  );
  await Promise.all([chmod(authorizationPath, 0o600), chmod(configPath, 0o600)]);
  const secret = "01234567890123456789012345678901";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = Buffer.from('{"private":"installed-payload"}');
  const eventId = "installed-event-1";
  const eventType = "change.ready";
  const headers = {
    "x-lervo-timestamp": timestamp,
    "x-lervo-event-id": eventId,
    "x-lervo-event-type": eventType,
    "x-lervo-signature": signature(secret, timestamp, eventId, eventType, body),
  };
  const first = await serveOnce({ cli, root, config: configPath, secret, headers, body });
  assert.equal(first.statusCode, 202);
  assert.equal(first.body.status, "accepted");
  const replay = await serveOnce({ cli, root, config: configPath, secret, headers, body });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.status, "current");
  const assignments = parsed(await runInstalledCli(cli, ["assignment", "list", "--json"], root));
  assert.equal(assignments.assignments.length, 1);
  assert.equal(JSON.stringify(first).includes("installed-payload"), false);
  assert.equal(JSON.stringify(replay).includes(eventId), false);
  return { assignmentId: assignments.assignments[0].assignmentId };
}
