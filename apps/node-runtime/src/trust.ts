import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import { dirname } from "node:path";

import {
  ConfiguredEd25519PolicyTrustStore,
  type PolicyTrustStore,
} from "@lervo/policy";
import {
  ConfiguredEd25519RemoteCommandTrustStore,
  type RemoteCommandTrustStore,
} from "@lervo/remote-command";
import { readOwnerOnlyText, RuntimeSecurityError } from "@lervo/runtime-security";
import type { RemoteCommandTarget } from "@lervo/schemas";

import type { NodeRuntimeConfig } from "./config-types.js";
import { NodeRuntimeError } from "./errors.js";
import { parseRemoteCommandTrustConfig } from "./remote-command-config.js";

const MAXIMUM_PUBLIC_KEY_BYTES = 65_536;
const MAXIMUM_TRUST_FILE_BYTES = 262_144;

interface LoadedPublicKey {
  keyId: string;
  publicKey: KeyObject;
  publicKeyHash: string;
}

export interface LoadedNodeRuntimeTrust {
  commandKeys: LoadedPublicKey[];
  policyKeys: Array<LoadedPublicKey & {
    purposes: Array<"snapshot" | "approval" | "revocation">;
  }>;
}

type RemoteCommands = NonNullable<NodeRuntimeConfig["remoteCommands"]>;

async function trustConfig(commands: RemoteCommands): Promise<{
  commandKeys: NonNullable<RemoteCommands["commandKeys"]>;
  policyKeys: NonNullable<RemoteCommands["policyKeys"]>;
}> {
  if (commands.trustFile === undefined) {
    if (commands.commandKeys === undefined || commands.policyKeys === undefined) {
      throw new NodeRuntimeError("invalid_config", "No Node runtime trust source was provided.");
    }
    return {
      commandKeys: structuredClone(commands.commandKeys),
      policyKeys: structuredClone(commands.policyKeys),
    };
  }
  let serialized: string;
  try {
    serialized = await readOwnerOnlyText(commands.trustFile, MAXIMUM_TRUST_FILE_BYTES);
  } catch (error) {
    const code = error instanceof RuntimeSecurityError && error.code === "invalid_text"
      ? "invalid_config"
      : "unsafe_runtime_file";
    throw new NodeRuntimeError(code, "Could not read the Node runtime trust snapshot safely.", {
      cause: error,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new NodeRuntimeError("invalid_config", "The Node runtime trust snapshot is not valid JSON.", {
      cause: error,
    });
  }
  const parsed = parseRemoteCommandTrustConfig(value, dirname(commands.trustFile));
  if (parsed.commandKeys === undefined || parsed.policyKeys === undefined) {
    throw new NodeRuntimeError("invalid_config", "The Node runtime trust snapshot has no key list.");
  }
  return { commandKeys: parsed.commandKeys, policyKeys: parsed.policyKeys };
}

async function publicKey(path: string): Promise<{ key: KeyObject; publicKeyHash: string }> {
  let serialized: string;
  try {
    serialized = await readOwnerOnlyText(path, MAXIMUM_PUBLIC_KEY_BYTES);
  } catch (error) {
    const code = error instanceof RuntimeSecurityError && error.code === "invalid_text"
      ? "invalid_config"
      : "unsafe_runtime_file";
    throw new NodeRuntimeError(code, "Could not read the remote-control public key file safely.", {
      cause: error,
    });
  }
  try {
    const key = createPublicKey(serialized);
    const bytes = key.export({ type: "spki", format: "der" });
    return {
      key,
      publicKeyHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    };
  } catch (error) {
    throw new NodeRuntimeError("invalid_config", "The remote-control public key is invalid.", {
      cause: error,
    });
  }
}

export async function loadNodeRuntimeTrust(
  commands: RemoteCommands,
): Promise<LoadedNodeRuntimeTrust> {
  const config = await trustConfig(commands);
  const [commandKeys, policyKeys] = await Promise.all([
    Promise.all(config.commandKeys.map(async ({ keyId, publicKeyFile }) => {
      const loaded = await publicKey(publicKeyFile);
      return { keyId, publicKey: loaded.key, publicKeyHash: loaded.publicKeyHash };
    })),
    Promise.all(config.policyKeys.map(async ({ keyId, publicKeyFile, purposes }) => {
      const loaded = await publicKey(publicKeyFile);
      return {
        keyId,
        publicKey: loaded.key,
        publicKeyHash: loaded.publicKeyHash,
        purposes: [...purposes],
      };
    })),
  ]);
  return { commandKeys, policyKeys };
}

function assertKeyHistory(
  history: ReadonlyMap<string, string>,
  candidates: readonly LoadedPublicKey[],
): void {
  for (const candidate of candidates) {
    const previous = history.get(candidate.keyId);
    if (previous !== undefined && previous !== candidate.publicKeyHash) {
      throw new NodeRuntimeError(
        "invalid_config",
        "A new key ID is required when Node trust key material changes.",
      );
    }
  }
}

export class ReloadableNodeRuntimeTrust {
  readonly commandTrustStore: RemoteCommandTrustStore;
  readonly policyTrustStore: PolicyTrustStore;
  private commandCurrent: ConfiguredEd25519RemoteCommandTrustStore;
  private policyCurrent: ConfiguredEd25519PolicyTrustStore;
  private readonly commandHistory = new Map<string, string>();
  private readonly policyHistory = new Map<string, string>();

  constructor(
    initial: LoadedNodeRuntimeTrust,
    private readonly target: RemoteCommandTarget,
  ) {
    const stores = this.createStores(initial);
    this.commandCurrent = stores.command;
    this.policyCurrent = stores.policy;
    this.record(initial);
    this.commandTrustStore = {
      find: (keyId) => this.commandCurrent.find(keyId),
    };
    this.policyTrustStore = {
      find: (keyId) => this.policyCurrent.find(keyId),
    };
  }

  replace(candidate: LoadedNodeRuntimeTrust): void {
    assertKeyHistory(this.commandHistory, candidate.commandKeys);
    assertKeyHistory(this.policyHistory, candidate.policyKeys);
    const stores = this.createStores(candidate);
    this.commandCurrent = stores.command;
    this.policyCurrent = stores.policy;
    this.record(candidate);
  }

  private createStores(material: LoadedNodeRuntimeTrust): {
    command: ConfiguredEd25519RemoteCommandTrustStore;
    policy: ConfiguredEd25519PolicyTrustStore;
  } {
    return {
      command: new ConfiguredEd25519RemoteCommandTrustStore(material.commandKeys.map((key) => ({
        keyId: key.keyId,
        publicKey: key.publicKey,
        projects: [structuredClone(this.target)],
      }))),
      policy: new ConfiguredEd25519PolicyTrustStore(material.policyKeys.map((key) => ({
        keyId: key.keyId,
        publicKey: key.publicKey,
        projects: [structuredClone(this.target)],
        purposes: [...key.purposes],
      }))),
    };
  }

  private record(material: LoadedNodeRuntimeTrust): void {
    for (const key of material.commandKeys) {
      this.commandHistory.set(key.keyId, key.publicKeyHash);
    }
    for (const key of material.policyKeys) {
      this.policyHistory.set(key.keyId, key.publicKeyHash);
    }
  }
}
