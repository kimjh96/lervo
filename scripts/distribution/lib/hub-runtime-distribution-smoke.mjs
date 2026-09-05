import { execFile, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const maximumOutputBytes = 64 * 1024;

async function availableLoopbackPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error === undefined ? resolvePromise() : reject(error))),
  );
  return typeof address === "object" && address !== null ? address.port : undefined;
}

async function ownerFile(path, bytes) {
  await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
}

async function waitForClose(closed, timeoutMs) {
  let timer;
  const timedOut = await Promise.race([
    closed.then(() => false),
    new Promise((resolvePromise) => {
      timer = setTimeout(() => resolvePromise(true), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return !timedOut;
}

export async function observeProcessReadiness(input) {
  const child = spawn(input.command, input.arguments, {
    cwd: input.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  const closed = new Promise((resolvePromise) => child.once("close", resolvePromise));
  const ready = await new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    };
    const collect = (channel) => (chunk) => {
      outputBytes += chunk.length;
      if (channel === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
      if (outputBytes > maximumOutputBytes) finish(false);
      else if (stdout === input.expectedStdout && stderr === "") finish(true);
    };
    const timer = setTimeout(() => finish(false), input.readinessTimeoutMs);
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.once("error", () => finish(false));
    child.once("close", () => finish(false));
  });
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  if (!(await waitForClose(closed, input.shutdownTimeoutMs))) {
    child.kill("SIGKILL");
    await closed;
  }
  return ready && stdout === input.expectedStdout && stderr === "";
}

async function smokeConfiguredHub(payloadRoot, entrypoint, temporaryRoot) {
  const fixture = resolve(temporaryRoot, "configured-smoke");
  const secrets = resolve(fixture, "secrets");
  const state = resolve(fixture, "state");
  await mkdir(secrets, { recursive: true, mode: 0o700 });
  await mkdir(resolve(state, "command-cas"), { recursive: true, mode: 0o700 });
  const command = generateKeyPairSync("ed25519");
  const policy = generateKeyPairSync("ed25519");
  await ownerFile(
    resolve(secrets, "command.pem"),
    command.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  await ownerFile(
    resolve(secrets, "policy.pem"),
    policy.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  await ownerFile(resolve(secrets, "review.secret"), randomBytes(32));
  await ownerFile(
    resolve(secrets, "credentials.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      credentials: [
        {
          token: randomBytes(48).toString("base64url"),
          principalId: "node_distribution_smoke",
          permissions: ["sync.write"],
          projects: [],
        },
      ],
    })}\n`,
  );
  await ownerFile(
    resolve(secrets, "signing.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      policy: { keyId: "key_distribution_policy_01", privateKeyPath: "policy.pem" },
      command: { keyId: "key_distribution_command_01", privateKeyPath: "command.pem" },
    })}\n`,
  );
  const port = await availableLoopbackPort();
  if (port === undefined) return false;
  const config = resolve(fixture, "config.json");
  await ownerFile(
    config,
    `${JSON.stringify({
      schemaVersion: 1,
      listen: { host: "127.0.0.1", port },
      storage: {
        databasePath: resolve(state, "hub.sqlite"),
        commandCasPath: resolve(state, "command-cas"),
      },
      identity: { hubIdentityHash: `sha256:${"8".repeat(64)}` },
      credentialsFile: resolve(secrets, "credentials.json"),
      signingFile: resolve(secrets, "signing.json"),
      control: {
        reviewGrantSecretPath: resolve(secrets, "review.secret"),
        reviewGrantTtlSeconds: 60,
      },
      cleanup: {
        workerId: "hub:distribution:smoke",
        cycleIntervalMs: 60_000,
        maximumScannedObjects: 100,
      },
    })}\n`,
  );
  return observeProcessReadiness({
    command: process.execPath,
    arguments: [resolve(payloadRoot, entrypoint), "--config", config],
    cwd: payloadRoot,
    expectedStdout: `Lervo Hub started on 127.0.0.1:${port}.\n`,
    readinessTimeoutMs: 10_000,
    shutdownTimeoutMs: 10_000,
  });
}

export async function smokeHubDistribution(payloadRoot, entrypoint, temporaryRoot) {
  const result = await execFileAsync(process.execPath, [resolve(payloadRoot, entrypoint)], {
    cwd: payloadRoot,
    encoding: "utf8",
    maxBuffer: maximumOutputBytes,
    timeout: 10_000,
  }).catch((error) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));
  if (
    result.stdout !== "" ||
    result.stderr !==
      "Lervo Hub error (invalid_arguments): Usage: lervo-hub --config <config.json>\n"
  ) {
    return false;
  }
  return smokeConfiguredHub(payloadRoot, entrypoint, temporaryRoot);
}
