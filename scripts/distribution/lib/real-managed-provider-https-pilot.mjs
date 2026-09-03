import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { loadProjectManifest } from "../../../packages/project/dist/index.js";
import {
  calculateProjectIdentityHash,
  createProjectRegistrationRequest,
} from "../../../packages/sync-contract/dist/index.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const hubEntry = resolve(repositoryRoot, "apps/hub-runtime/dist/bin.js");
const nodeEntry = resolve(repositoryRoot, "apps/node-runtime/dist/bin.js");
const cliEntry = resolve(repositoryRoot, "apps/cli/dist/bin.js");
const providers = ["codex", "claude"];
const destinationId = "hub:https-real-pilot";
const nodeId = "node_https_real_pilot_01";
const hubIdentityHash = `sha256:${"8".repeat(64)}`;
const nodeToken = "node-real-pilot-token-aaaaaaaaaaaaaaaaaaaaaaaa";
const operatorToken = "operator-real-pilot-token-bbbbbbbbbbbbbbbbbbbbb";
const timeoutMs = 12 * 60_000;

async function ownerFile(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("pilot port unavailable");
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error === undefined ? resolvePromise() : reject(error))),
  );
  return address.port;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? "signal"})`);
  }
  return result.stdout;
}

function startProcess(entry, configPath, environment = {}) {
  const child = spawn(process.execPath, [entry, "--config", configPath], {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-16_384);
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });
  return { child, stdout: () => stdout, stderr: () => stderr };
}

async function waitForStarted(processState, marker) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processState.stdout().includes(marker)) return;
    if (processState.child.exitCode !== null) {
      throw new Error(`pilot process exited before readiness: ${processState.stderr()}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`pilot process readiness timeout: ${processState.stderr()}`);
}

async function stopProcess(processState) {
  if (processState === undefined || processState.child.exitCode !== null) return;
  processState.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => processState.child.once("exit", resolvePromise)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("pilot process stop timeout")), 30_000),
    ),
  ]);
  if (processState.child.exitCode !== 0) {
    throw new Error(`pilot process failed during shutdown: ${processState.stderr()}`);
  }
}

async function httpsJson({ port, certificate, method = "GET", path, token, body }) {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolvePromise, reject) => {
    const request = httpsRequest(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        ca: certificate,
        minVersion: "TLSv1.3",
        headers: {
          authorization: `Bearer ${token}`,
          ...(serialized === undefined
            ? {}
            : {
                "content-type": "application/json; charset=utf-8",
                "content-length": String(Buffer.byteLength(serialized)),
              }),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let value;
          try {
            value = text.length === 0 ? null : JSON.parse(text);
          } catch {
            reject(new Error(`pilot received non-JSON response (${response.statusCode})`));
            return;
          }
          resolvePromise({ status: response.statusCode, value });
        });
      },
    );
    request.once("error", reject);
    if (serialized !== undefined) request.write(serialized);
    request.end();
  });
}

function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label} failed (${response.status ?? "missing"})`);
  }
  return response.value;
}

function endpoint(projectId, kind, target) {
  const query = new URLSearchParams({
    destinationId,
    projectIdentityHash: target.projectIdentityHash,
  });
  return `/v1/${kind}/projects/${projectId}` + `?${query.toString()}`;
}

async function prepareProject(root) {
  run(process.execPath, [
    cliEntry,
    "init",
    "--root",
    root,
    "--name",
    "managed-https-pilot",
    "--json",
  ]);
  const manifestPath = resolve(root, ".lervo/project.yaml");
  const manifestSource = await readFile(manifestPath, "utf8");
  if (!manifestSource.includes("hubSyncEnabled: false")) {
    throw new Error("pilot project data policy default changed");
  }
  await ownerFile(
    manifestPath,
    manifestSource.replace("hubSyncEnabled: false", "hubSyncEnabled: true"),
  );
  await mkdir(resolve(root, "src"), { recursive: true });
  await ownerFile(
    resolve(root, "AGENTS.md"),
    [
      "This repository is for the real HTTPS managed-provider pilot.",
      "For each request, create only the approved src file and do not modify any other files.",
      "",
    ].join("\n"),
  );
  for (const provider of providers) {
    const expected = `export const httpsPilot = "${provider}";\n`;
    await ownerFile(
      resolve(root, `.lervo/verifications/pilot.${provider}.yaml`),
      [
        "schemaVersion: 1",
        `suiteId: pilot.${provider}`,
        "stopOnFailure: true",
        "commands:",
        `  - commandId: verify-${provider}`,
        "    executable: node",
        "    arguments:",
        "      - -e",
        `      - ${JSON.stringify(`const fs=require('node:fs');process.exit(fs.readFileSync('src/${provider}.ts','utf8')===${JSON.stringify(expected)}?0:1)`)}`,
        "    cwd: .",
        "    timeoutMs: 10000",
        "    maxOutputBytes: 4096",
        "    environmentVariableNames: []",
        "",
      ].join("\n"),
    );
  }
}

async function waitForCompletion(hubDatabasePath, expectedCount) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const database = new DatabaseSync(hubDatabasePath, { readOnly: true });
      const row = database
        .prepare("SELECT COUNT(*) AS count FROM hub_remote_commands WHERE status = 'completed'")
        .get();
      database.close();
      if (Number(row?.count) === expectedCount) return;
    } catch {
      // The Hub may be between WAL commits; retry within the bounded deadline.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("managed HTTPS pilot completion timeout");
}

async function eventSummary(projectRoot) {
  const database = new DatabaseSync(resolve(projectRoot, ".lervo/state/events.sqlite"), {
    readOnly: true,
  });
  const completed = database
    .prepare("SELECT run_id, payload_json FROM events WHERE type = 'run.completed' ORDER BY seq")
    .all();
  const changed = database
    .prepare("SELECT payload_json FROM events WHERE type = 'file.changed' ORDER BY seq")
    .all();
  const verifications = database
    .prepare("SELECT payload_json FROM events WHERE type = 'verification.completed' ORDER BY seq")
    .all();
  database.close();
  return {
    runIds: completed.map((row) => row.run_id),
    changedPaths: changed.map((row) => JSON.parse(row.payload_json).path),
    verificationStatuses: verifications.map((row) => JSON.parse(row.payload_json).status),
  };
}

export async function runRealManagedProviderHttpsPilot() {
  const pilotRoot = await mkdtemp(resolve(tmpdir(), "lervo-real-https-pilot-"));
  const projectRoot = resolve(pilotRoot, "repository");
  const hubState = resolve(pilotRoot, "hub-state");
  const secrets = resolve(pilotRoot, "secrets");
  let hub;
  let node;
  let passed = false;
  try {
    await mkdir(projectRoot, { recursive: true, mode: 0o700 });
    await mkdir(hubState, { recursive: true, mode: 0o700 });
    await mkdir(secrets, { recursive: true, mode: 0o700 });
    await prepareProject(projectRoot);
    const manifest = await loadProjectManifest(projectRoot);
    const target = {
      projectId: manifest.projectId,
      projectIdentityHash: calculateProjectIdentityHash(manifest),
    };
    const commandKeys = generateKeyPairSync("ed25519");
    const policyKeys = generateKeyPairSync("ed25519");
    await ownerFile(
      resolve(secrets, "command-private.pem"),
      commandKeys.privateKey.export({
        type: "pkcs8",
        format: "pem",
      }),
    );
    await ownerFile(
      resolve(secrets, "command-public.pem"),
      commandKeys.publicKey.export({
        type: "spki",
        format: "pem",
      }),
    );
    await ownerFile(
      resolve(secrets, "policy-private.pem"),
      policyKeys.privateKey.export({
        type: "pkcs8",
        format: "pem",
      }),
    );
    await ownerFile(
      resolve(secrets, "policy-public.pem"),
      policyKeys.publicKey.export({
        type: "spki",
        format: "pem",
      }),
    );
    await ownerFile(resolve(secrets, "review.secret"), randomBytes(32));
    await ownerFile(resolve(secrets, "node.token"), `${nodeToken}\n`);
    const certificatePath = resolve(secrets, "hub.crt");
    const tlsKeyPath = resolve(secrets, "hub.key");
    run("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-keyout",
      tlsKeyPath,
      "-out",
      certificatePath,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ]);
    await chmod(certificatePath, 0o600);
    await chmod(tlsKeyPath, 0o600);
    const certificate = await readFile(certificatePath, "utf8");
    const port = await availablePort();
    await ownerFile(
      resolve(secrets, "hub-credentials.json"),
      JSON.stringify({
        schemaVersion: 1,
        credentials: [
          {
            token: nodeToken,
            principalId: nodeId,
            permissions: ["sync.write", "policy.read", "command.delivery"],
            projects: [{ destinationId, projectId: manifest.projectId }],
          },
          {
            token: operatorToken,
            principalId: "operator:https-real-pilot",
            permissions: [
              "sync.write",
              "policy.write",
              "approval.write",
              "command.write",
              "command.read",
            ],
            projects: [{ destinationId, projectId: manifest.projectId }],
          },
        ],
      }),
    );
    const hubConfigPath = resolve(pilotRoot, "hub.json");
    const hubDatabasePath = resolve(hubState, "hub.sqlite");
    await ownerFile(
      hubConfigPath,
      JSON.stringify({
        schemaVersion: 1,
        listen: { host: "127.0.0.1", port },
        tls: {
          certificatePath,
          privateKeyPath: tlsKeyPath,
        },
        storage: {
          databasePath: hubDatabasePath,
          commandCasPath: resolve(hubState, "command-cas"),
        },
        identity: { hubIdentityHash },
        credentialsFile: resolve(secrets, "hub-credentials.json"),
        signing: {
          policy: {
            keyId: "key_https_pilot_policy_01",
            privateKeyPath: resolve(secrets, "policy-private.pem"),
          },
          command: {
            keyId: "key_https_pilot_command_01",
            privateKeyPath: resolve(secrets, "command-private.pem"),
          },
        },
        control: {
          reviewGrantSecretPath: resolve(secrets, "review.secret"),
          reviewGrantTtlSeconds: 600,
        },
        cleanup: {
          workerId: "hub:https-real-pilot",
          cycleIntervalMs: 60_000,
          maximumScannedObjects: 100,
        },
      }),
    );
    hub = startProcess(hubEntry, hubConfigPath);
    await waitForStarted(hub, "Lervo Hub");

    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId,
      requestedAt: new Date().toISOString(),
    });
    const registrationQuery = new URLSearchParams({
      destinationId,
      projectIdentityHash: target.projectIdentityHash,
    });
    expectStatus(
      await httpsJson({
        port,
        certificate,
        method: "POST",
        path: `/v1/sync/projects/${manifest.projectId}/registration?${registrationQuery.toString()}`,
        token: operatorToken,
        body: registration,
      }),
      201,
      "project registration",
    );

    const commands = [];
    for (const provider of providers) {
      const request = [
        `Create src/${provider}.ts containing exactly one line, export const httpsPilot = "${provider}";, followed by a final newline.`,
        "Do not modify any other files.",
      ].join(" ");
      const response = expectStatus(
        await httpsJson({
          port,
          certificate,
          method: "POST",
          path: endpoint(manifest.projectId, "commands", target).replace(
            `/v1/commands/projects/${manifest.projectId}`,
            `/v1/commands/projects/${manifest.projectId}/submissions`,
          ),
          token: operatorToken,
          body: {
            schemaVersion: 1,
            idempotencyKey: `idk_https_real_${provider}_01`,
            lifetimeMs: 5 * 60_000,
            roleId: "developer",
            provider,
            risk: "medium",
            verificationSuiteIds: [`pilot.${provider}`],
            request,
          },
        }),
        201,
        `${provider} command authoring`,
      );
      commands.push({ provider, commandId: response.envelope.command.commandId });
    }

    const policyQuery = new URLSearchParams({
      destinationId,
      projectIdentityHash: target.projectIdentityHash,
    });
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    expectStatus(
      await httpsJson({
        port,
        certificate,
        method: "POST",
        path: `/v1/policy/projects/${manifest.projectId}/snapshots?${policyQuery.toString()}`,
        token: operatorToken,
        body: {
          schemaVersion: 1,
          rules: [
            {
              ruleId: "polr_https_real_write_01",
              roleId: "developer",
              risk: "medium",
              capability: "filesystem.write",
              repositoryPaths: providers.map((provider) => `src/${provider}.ts`),
              decision: "require_approval",
            },
          ],
          expiresAt,
        },
      }),
      201,
      "policy snapshot authoring",
    );
    for (const command of commands) {
      expectStatus(
        await httpsJson({
          port,
          certificate,
          method: "POST",
          path: `/v1/policy/projects/${manifest.projectId}/approvals?${policyQuery.toString()}`,
          token: operatorToken,
          body: {
            schemaVersion: 1,
            commandId: command.commandId,
            capability: "filesystem.write",
            repositoryPaths: [`src/${command.provider}.ts`],
            expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
          },
        }),
        201,
        `${command.provider} approval authoring`,
      );
    }

    const nodeConfigPath = resolve(pilotRoot, "node.json");
    const nodeTrustPath = resolve(secrets, "node-trust.json");
    await ownerFile(
      nodeTrustPath,
      JSON.stringify({
        schemaVersion: 1,
        commandKeys: [
          {
            keyId: "key_https_pilot_command_01",
            publicKeyFile: "command-public.pem",
          },
        ],
        policyKeys: [
          {
            keyId: "key_https_pilot_policy_01",
            publicKeyFile: "policy-public.pem",
            purposes: ["snapshot", "approval", "revocation"],
          },
        ],
      }),
    );
    await ownerFile(
      nodeConfigPath,
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: projectRoot,
        hub: {
          baseUrl: `https://127.0.0.1:${port}/`,
          bearerTokenFile: resolve(secrets, "node.token"),
          destinationId,
          hubIdentityHash,
        },
        sync: {
          workerId: "node:https-real-pilot:sync",
          idlePollIntervalMs: 100,
          retryDelayMs: 1_000,
          requestTimeoutMs: 30_000,
        },
        remoteCommands: {
          nodeId,
          trustFile: nodeTrustPath,
          providerHost: { providers, roles: ["developer"], developerSkills: [] },
          idlePollIntervalMs: 100,
          retryDelayMs: 1_000,
          limit: 1,
          requestTimeoutMs: 30_000,
          maxLifetimeMs: 15 * 60_000,
        },
      }),
    );
    node = startProcess(nodeEntry, nodeConfigPath, { NODE_EXTRA_CA_CERTS: certificatePath });
    await waitForStarted(node, "Lervo Node synchronization");
    await waitForCompletion(hubDatabasePath, providers.length);
    await stopProcess(node);
    node = undefined;
    await stopProcess(hub);
    hub = undefined;

    const summary = await eventSummary(projectRoot);
    if (
      summary.runIds.length !== providers.length ||
      JSON.stringify(summary.changedPaths) !==
        JSON.stringify(providers.map((provider) => `src/${provider}.ts`)) ||
      summary.verificationStatuses.length !== providers.length ||
      summary.verificationStatuses.some((status) => status !== "passed")
    ) {
      throw new Error("managed HTTPS pilot evidence is incomplete");
    }
    for (const provider of providers) {
      const expected = `export const httpsPilot = "${provider}";\n`;
      if ((await readFile(resolve(projectRoot, `src/${provider}.ts`), "utf8")) !== expected) {
        throw new Error(`${provider} managed output mismatch`);
      }
    }
    passed = true;
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "passed",
          providers,
          runIds: summary.runIds,
          changedPaths: summary.changedPaths,
          verificationStatuses: summary.verificationStatuses,
          transport: "https",
          minimumTlsVersion: "TLSv1.3",
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await stopProcess(node).catch(() => undefined);
    await stopProcess(hub).catch(() => undefined);
    if (passed || process.env.LERVO_KEEP_REAL_PILOT !== "1") {
      await rm(pilotRoot, { recursive: true, force: true });
    } else {
      process.stderr.write("Lervo HTTPS pilot failed; temporary evidence was retained.\n");
    }
  }
}
