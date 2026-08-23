import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadNodeRuntimeTrust,
  ReloadableNodeRuntimeTrust,
  type NodeRuntimeConfig,
} from "../src/index.js";
import {
  ownerFile,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

afterEach(removeTemporaryRoots);

const target = {
  projectId: "prj_node_runtime_01",
  projectIdentityHash: `sha256:${"9".repeat(64)}`,
};

function publicPem(keys: ReturnType<typeof generateKeyPairSync>): string {
  return String(keys.publicKey.export({ type: "spki", format: "pem" }));
}

describe("Node runtime trust snapshot", () => {
  it("requires a strict owner-only external snapshot", async () => {
    const root = await temporaryRoot();
    const trustFile = resolve(root, "node-trust.json");
    await ownerFile(trustFile, JSON.stringify({
      schemaVersion: 1,
      commandKeys: [],
      policyKeys: [],
      unknown: true,
    }));
    const commands = {
      nodeId: "node_runtime_control_01",
      trustFile,
    } as NonNullable<NodeRuntimeConfig["remoteCommands"]>;
    await expect(loadNodeRuntimeTrust(commands)).rejects.toMatchObject({ code: "invalid_config" });
    if (process.platform !== "win32") {
      await chmod(trustFile, 0o644);
      await expect(loadNodeRuntimeTrust(commands)).rejects.toMatchObject({
        code: "unsafe_runtime_file",
      });
    }
  });

  it("atomically rotates command and policy trust with new key IDs", async () => {
    const root = await temporaryRoot();
    const keyDirectory = resolve(root, "keys");
    await mkdir(keyDirectory, { mode: 0o700 });
    const initialCommand = generateKeyPairSync("ed25519");
    const initialPolicy = generateKeyPairSync("ed25519");
    const rotatedCommand = generateKeyPairSync("ed25519");
    const rotatedPolicy = generateKeyPairSync("ed25519");
    await Promise.all([
      ownerFile(resolve(keyDirectory, "command-01.pem"), publicPem(initialCommand)),
      ownerFile(resolve(keyDirectory, "policy-01.pem"), publicPem(initialPolicy)),
      ownerFile(resolve(keyDirectory, "command-02.pem"), publicPem(rotatedCommand)),
      ownerFile(resolve(keyDirectory, "policy-02.pem"), publicPem(rotatedPolicy)),
    ]);
    const trustFile = resolve(root, "node-trust.json");
    const snapshot = (suffix: "01" | "02") => ({
      schemaVersion: 1,
      commandKeys: [{
        keyId: `key_command_runtime_${suffix}`,
        publicKeyFile: `keys/command-${suffix}.pem`,
      }],
      policyKeys: [{
        keyId: `key_policy_runtime_${suffix}`,
        publicKeyFile: `keys/policy-${suffix}.pem`,
        purposes: ["snapshot", "approval", "revocation"],
      }],
    });
    await ownerFile(trustFile, JSON.stringify(snapshot("01")));
    const commands = {
      nodeId: "node_runtime_control_01",
      trustFile,
    } as NonNullable<NodeRuntimeConfig["remoteCommands"]>;
    const trust = new ReloadableNodeRuntimeTrust(await loadNodeRuntimeTrust(commands), target);
    const message = Buffer.from("node trust rotation fixture");
    const firstCommand = await trust.commandTrustStore.find("key_command_runtime_01");
    expect(await firstCommand?.verify({
      message,
      signature: sign(null, message, initialCommand.privateKey),
    })).toBe(true);

    await ownerFile(trustFile, JSON.stringify(snapshot("02")));
    trust.replace(await loadNodeRuntimeTrust(commands));
    expect(await trust.commandTrustStore.find("key_command_runtime_01")).toBeNull();
    expect(await firstCommand?.verify({
      message,
      signature: sign(null, message, initialCommand.privateKey),
    })).toBe(true);
    const nextCommand = await trust.commandTrustStore.find("key_command_runtime_02");
    const nextPolicy = await trust.policyTrustStore.find("key_policy_runtime_02");
    expect(await nextCommand?.verify({
      message,
      signature: sign(null, message, rotatedCommand.privateKey),
    })).toBe(true);
    expect(await nextPolicy?.verify({
      message,
      signature: sign(null, message, rotatedPolicy.privateKey),
    })).toBe(true);
  });

  it("rejects different public material under a previously observed key ID", async () => {
    const root = await temporaryRoot();
    const keyDirectory = resolve(root, "keys");
    await mkdir(keyDirectory, { mode: 0o700 });
    const first = generateKeyPairSync("ed25519");
    const replacement = generateKeyPairSync("ed25519");
    await ownerFile(resolve(keyDirectory, "command.pem"), publicPem(first));
    await ownerFile(resolve(keyDirectory, "policy.pem"), publicPem(first));
    const trustFile = resolve(root, "node-trust.json");
    await ownerFile(trustFile, JSON.stringify({
      schemaVersion: 1,
      commandKeys: [{ keyId: "key_command_runtime_01", publicKeyFile: "keys/command.pem" }],
      policyKeys: [{
        keyId: "key_policy_runtime_01",
        publicKeyFile: "keys/policy.pem",
        purposes: ["snapshot"],
      }],
    }));
    const commands = {
      nodeId: "node_runtime_control_01",
      trustFile,
    } as NonNullable<NodeRuntimeConfig["remoteCommands"]>;
    const trust = new ReloadableNodeRuntimeTrust(await loadNodeRuntimeTrust(commands), target);
    await ownerFile(resolve(keyDirectory, "command.pem"), publicPem(replacement));
    await expect(loadNodeRuntimeTrust(commands).then((candidate) => trust.replace(candidate)))
      .rejects.toMatchObject({ code: "invalid_config" });
    const signer = await trust.commandTrustStore.find("key_command_runtime_01");
    const message = Buffer.from("retained trust fixture");
    expect(await signer?.verify({
      message,
      signature: sign(null, message, first.privateKey),
    })).toBe(true);
  });
});
