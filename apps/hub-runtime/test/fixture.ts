import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:net";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const roots: string[] = [];

export const runtimeToken = "hub-runtime-test-token-aaaaaaaaaaaaaaaaaaaaaaaa";
export const rotatedRuntimeToken = "hub-runtime-test-token-bbbbbbbbbbbbbbbbbbbbbbbb";
export const runtimeDestinationId = "hub:runtime-test";
export const runtimeProjectId = "prj_runtime_test_01";

export const runtimeTlsCertificate = `-----BEGIN CERTIFICATE-----
MIICyTCCAbGgAwIBAgIJAMB6yesF/KUCMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNV
BAMMCWxvY2FsaG9zdDAeFw0yNjA4MjIwNjEwMzZaFw0zNjA4MTkwNjEwMzZaMBQx
EjAQBgNVBAMMCWxvY2FsaG9zdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoC
ggEBAMoYb2neUNDF4BSx/Ev4LgduK/NbSKWjTvnQF2iKPgB+C/g1u2d/4LdWCTRg
1m4gEMx/kN/N1xtKHfdkCPji4xPVAcxpktvsbYkawC6L79sbpLNpcBdQMObUY8U2
ikv55+Tnpwi93nYI9ht9jAoD0BdRXlcc+jLlLbsJ6rJzv3pmTWfsdQBTZ1cW+Pub
r7JhbafXZ6K1u+7AT2i1/drsGwxTEniysWrtwe4yDdFUd0L1UsF1xai8IxV4//Vg
af8CQpBYIEBSJvYIzcZrplU4IEryhL7DsLd4hoFJ+GyYPgL+IkOomQBAEOazcpaa
2vWWLqncRpPvM1bSzYgfsYMO320CAwEAAaMeMBwwGgYDVR0RBBMwEYIJbG9jYWxo
b3N0hwR/AAABMA0GCSqGSIb3DQEBCwUAA4IBAQAU3IlHx0R8/OFtgkVTeWAuJy/A
TME5ycVHZaGardpbJVOVpR7/NbjBYMQJxf6h5is9Sbqsuv4fbi1ISI2odAxd/B7S
Zp4SHQbQd/y+ELU+ScIwmC5b1Sh73Y5FaegfVvdm7zhwdqEW0t6Gn4nkaH5JTNEq
4CdC41veiPeic27PCU1h2a6I1V5yXmcLIubxj/HF3rWzddhhGXZ9zyz7L17NjvuS
xbdktsGipgNGvMW7oKR+KJN7NO1EPX5dLUPjxKoTxb3tiURovT52w+gUYha1mwVo
AjeBBzTM7Tc0Vtg5yNx3TxkxQNg7I+yP99rHe2vTqIsUlswShms+Lqmh7vI7
-----END CERTIFICATE-----
`;

const runtimeTlsPrivateKey = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDKGG9p3lDQxeAU
sfxL+C4HbivzW0ilo0750Bdoij4Afgv4Nbtnf+C3Vgk0YNZuIBDMf5DfzdcbSh33
ZAj44uMT1QHMaZLb7G2JGsAui+/bG6SzaXAXUDDm1GPFNopL+efk56cIvd52CPYb
fYwKA9AXUV5XHPoy5S27Ceqyc796Zk1n7HUAU2dXFvj7m6+yYW2n12eitbvuwE9o
tf3a7BsMUxJ4srFq7cHuMg3RVHdC9VLBdcWovCMVeP/1YGn/AkKQWCBAUib2CM3G
a6ZVOCBK8oS+w7C3eIaBSfhsmD4C/iJDqJkAQBDms3KWmtr1li6p3EaT7zNW0s2I
H7GDDt9tAgMBAAECggEBAIT1kI9ZaVgBZ0yWUMP2cuoGjLndy6zWBYaLZmsr0GDo
jJ1vVG1ij4hu/T1NnKX1SLgSEVF9DlFw8MgrM0/zjawljrpalvlD0kjKpbe570L7
K9+xtcJQyuuCvmUoXdJghzVtRtKUgECt4qTxc2m/Wm+M5AFyGhXT+8M7YgKn7kjq
y7xwNFNzj5y9wGa7uZqEOhnVj/VW4TkWwd+34ZN1Pe2K5pIC2ylklE9QZqcWglhI
t1gn2hm+X2KUasrOHEEzzDNE3osKp1JK3RruANWNY50Tx0UYGufb0hn4LYAgOiIN
IIiYStxhyZjweu9HL1vZ5phVzChHDOjZ4tf31UhyNa0CgYEA76wRidPI+Ljz+lk/
OW/AX7tYUOoDkThlDldV5ehVhE6tY/m/4BgKDdH33cxsHxQM+4gb8ReTo8t40CV3
qgeA1jTZXEgSgmt3sntXoUuaE6bqUGwgx1xYK1yDqimrxa3JPbdc0QPdVqDD4LcK
Pn6edlcKMnVl5tC1hOkr5ckNS38CgYEA190FfaBUz8lMiAn/IAThwXrz78wBUGic
9n39C5J7UP2EH4aCmFkAIh4onP77LlmaQtR+BFFFCYc9U8Ru0ghCqcvpiCC77sas
34eAdeWkSd0fhKrkgdg+1SUtPQwbHj54lLFK5lbnAvQmCic6UG/b78PS1GfCnehR
sDpt479UOxMCgYBv7m1WcBlIx5/yCGI1odI3I1iQmWnHFY5kjzcno0TlAJWLvmT0
9GUlpSzcYg8QyJ1zj1J1Wyxxb6Jhm03yk4SBBbeJmINEc4o4SdBYHOW9TdPacVUx
phfrUE6RVtrI/GuirhLj7qkdPwGb3gAjxaCd5fJ2NEu96zUK+JauvyG9YwKBgFlM
FmRkuhEG/gDc2cx+GIH4ggb2BqkjzaLudYqe+yKC7XA5LbcmQjba8QQZOwFukbEJ
xGO21u9dIdKQVSPPxPwG3cGxgO0DBSqnHE4pRHBF6C7ynvrT4RI9gdxaMLGvOCSS
vyBQXNpM85uJpMb3ry0dfg7eKZU3MOvND/6B/K8/AoGAPeoND4A3I4JZxqjqyFQH
oalD36gWAym4QbralJ3kRdQO8QLQ+2bIWYWhSm3qodgXhzMWRhWdSl2bgI2utjiI
1Rn0SmxVgkNbOPOooaY5DGttuV864zwGRP4nEXV/UiccMefgHEHJXVLVVVECtQp3
XFJbokQpjuXDQsy+LKaCLHA=
-----END PRIVATE KEY-----
`;

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

export async function ownerFile(path: string, content: string | Uint8Array): Promise<void> {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function enableRuntimeSigningFile(
  root: string,
  fixture: { configPath: string; value: Record<string, unknown> },
): Promise<void> {
  const signing = fixture.value.signing;
  await ownerFile(resolve(root, "signing.json"), JSON.stringify({
    schemaVersion: 1,
    ...(signing as Record<string, unknown>),
  }));
  delete fixture.value.signing;
  fixture.value.signingFile = "signing.json";
  await ownerFile(fixture.configPath, JSON.stringify(fixture.value));
}

export async function writeRotatedRuntimeSigning(
  root: string,
  options: {
    policyKeyId?: string;
    commandKeyId?: string;
  } = {},
): Promise<{
  policyKeyId: string;
  commandKeyId: string;
}> {
  const policy = generateKeyPairSync("ed25519");
  const command = generateKeyPairSync("ed25519");
  const policyKeyId = options.policyKeyId ?? "key_runtime_policy_02";
  const commandKeyId = options.commandKeyId ?? "key_runtime_command_02";
  await ownerFile(resolve(root, "policy-rotated.pem"), policy.privateKey.export({
    type: "pkcs8",
    format: "pem",
  }));
  await ownerFile(resolve(root, "command-rotated.pem"), command.privateKey.export({
    type: "pkcs8",
    format: "pem",
  }));
  await ownerFile(resolve(root, "signing.json"), JSON.stringify({
    schemaVersion: 1,
    policy: { keyId: policyKeyId, privateKeyPath: "policy-rotated.pem" },
    command: { keyId: commandKeyId, privateKeyPath: "command-rotated.pem" },
  }));
  return { policyKeyId, commandKeyId };
}

function credentialSnapshot(token: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    credentials: [{
      token,
      principalId: "operator:runtime-test",
      permissions: [
        "trace.read",
        "sync.write",
        "workstream.read",
        "workstream.write",
        "policy.read",
        "policy.write",
        "command.read",
        "command.write",
        "command.delivery",
        "approval.write",
      ],
      projects: [{ destinationId: runtimeDestinationId, projectId: runtimeProjectId }],
    }],
  };
}

export async function writeRuntimeCredentials(root: string, token: string): Promise<void> {
  await ownerFile(resolve(root, "credentials.json"), JSON.stringify(credentialSnapshot(token)));
}

export async function enableRuntimeTls(
  root: string,
  fixture: { configPath: string; value: Record<string, unknown> },
): Promise<void> {
  await ownerFile(resolve(root, "tls.crt"), runtimeTlsCertificate);
  await ownerFile(resolve(root, "tls.key"), runtimeTlsPrivateKey);
  fixture.value.tls = { certificatePath: "tls.crt", privateKeyPath: "tls.key" };
  await ownerFile(fixture.configPath, JSON.stringify(fixture.value));
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
  await writeRuntimeCredentials(root, runtimeToken);
  const value = {
    schemaVersion: 1,
    listen: { host: "127.0.0.1", port },
    storage: {
      databasePath: "state/hub.sqlite",
      commandCasPath: "state/command-cas",
    },
    identity: { hubIdentityHash: `sha256:${"9".repeat(64)}` },
    credentialsFile: "credentials.json",
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
