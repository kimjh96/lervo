import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:net";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const roots: string[] = [];

export const runtimeToken = "hub-runtime-test-token-aaaaaaaaaaaaaaaaaaaaaaaa";

export async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-hub-runtime-"));
  roots.push(root);
  return root;
}

export async function removeTemporaryRoots(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test port unavailable");
  await new Promise<void>((resolve, reject) => server.close((error) =>
    error === undefined ? resolve() : reject(error)
  ));
  return address.port;
}

async function ownerFile(path: string, content: string | Uint8Array): Promise<void> {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function runtimeConfigFixture(root: string, port: number): Promise<{
  configPath: string;
  databasePath: string;
  value: Record<string, unknown>;
}> {
  const policyKeys = generateKeyPairSync("ed25519");
  const commandKeys = generateKeyPairSync("ed25519");
  await ownerFile(resolve(root, "policy.pem"), policyKeys.privateKey.export({
    type: "pkcs8",
    format: "pem",
  }));
  await ownerFile(resolve(root, "command.pem"), commandKeys.privateKey.export({
    type: "pkcs8",
    format: "pem",
  }));
  await ownerFile(resolve(root, "review.secret"), Buffer.alloc(32, 7));
  const value = {
    schemaVersion: 1,
    listen: { host: "127.0.0.1", port },
    storage: {
      databasePath: "state/hub.sqlite",
      commandCasPath: "state/command-cas",
    },
    identity: { hubIdentityHash: `sha256:${"9".repeat(64)}` },
    credentials: [{
      token: runtimeToken,
      principalId: "operator:runtime-test",
      permissions: [
        "trace.read",
        "policy.read",
        "policy.write",
        "command.read",
        "command.write",
        "command.delivery",
        "approval.write",
      ],
      projects: [],
    }],
    signing: {
      policy: { keyId: "key_runtime_policy_01", privateKeyPath: "policy.pem" },
      command: { keyId: "key_runtime_command_01", privateKeyPath: "command.pem" },
    },
    control: {
      reviewGrantSecretPath: "review.secret",
      reviewGrantTtlSeconds: 600,
    },
    cleanup: {
      workerId: "hub:runtime-test",
      cycleIntervalMs: 60_000,
      maximumScannedObjects: 100,
    },
  };
  const configPath = resolve(root, "hub-runtime.json");
  await ownerFile(configPath, JSON.stringify(value));
  return {
    configPath,
    databasePath: resolve(root, "state/hub.sqlite"),
    value,
  };
}
