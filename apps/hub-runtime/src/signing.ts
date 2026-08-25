import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { dirname } from "node:path";

import { Ed25519PolicySigner } from "@lervo/policy";
import { Ed25519RemoteCommandSigner } from "@lervo/remote-command";

import type { HubRuntimeConfig, HubRuntimeSigningConfig } from "./config-types.js";
import { parseHubRuntimeSigningConfig } from "./config.js";
import { HubRuntimeError } from "./errors.js";
import { readOwnerOnlyFile, readOwnerOnlyText } from "./secure-file.js";

const MAXIMUM_PRIVATE_KEY_BYTES = 16_384;
const MAXIMUM_SIGNING_FILE_BYTES = 65_536;

export interface LoadedHubRuntimeSigner<T> {
  signer: T;
  publicKeyHash: string;
}

export interface LoadedHubRuntimeSigning {
  policy: LoadedHubRuntimeSigner<Ed25519PolicySigner>;
  command: LoadedHubRuntimeSigner<Ed25519RemoteCommandSigner>;
}

function signingSnapshot(
  value: unknown,
  baseDirectory: string,
): NonNullable<HubRuntimeConfig["signing"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HubRuntimeError("invalid_config", "The Hub signing snapshot is invalid.");
  }
  const source = value as Record<string, unknown>;
  if (
    Object.keys(source).some((key) => !["schemaVersion", "policy", "command"].includes(key)) ||
    source.schemaVersion !== 1
  )
    throw new HubRuntimeError("invalid_config", "The Hub signing snapshot contract is invalid.");
  return {
    policy: parseHubRuntimeSigningConfig(source.policy, baseDirectory, "signing.policy"),
    command: parseHubRuntimeSigningConfig(source.command, baseDirectory, "signing.command"),
  };
}

async function loadSigningConfig(
  config: HubRuntimeConfig,
): Promise<NonNullable<HubRuntimeConfig["signing"]>> {
  if (config.signing !== undefined) return structuredClone(config.signing);
  if (config.signingFile === undefined) {
    throw new HubRuntimeError("invalid_config", "No Hub signing source was provided.");
  }
  const serialized = await readOwnerOnlyText(config.signingFile, MAXIMUM_SIGNING_FILE_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new HubRuntimeError("invalid_config", "The Hub signing snapshot is not valid JSON.", {
      cause: error,
    });
  }
  return signingSnapshot(value, dirname(config.signingFile));
}

async function privateKey(config: HubRuntimeSigningConfig) {
  const bytes = await readOwnerOnlyFile(config.privateKeyPath, MAXIMUM_PRIVATE_KEY_BYTES);
  try {
    const key = createPrivateKey(bytes);
    const publicBytes = createPublicKey(key).export({ type: "spki", format: "der" });
    return {
      key,
      publicKeyHash: `sha256:${createHash("sha256").update(publicBytes).digest("hex")}`,
    };
  } finally {
    bytes.fill(0);
  }
}

export async function loadHubRuntimeSigning(
  config: HubRuntimeConfig,
): Promise<LoadedHubRuntimeSigning> {
  const signing = await loadSigningConfig(config);
  try {
    const [policy, command] = await Promise.all([
      privateKey(signing.policy),
      privateKey(signing.command),
    ]);
    return {
      policy: {
        signer: new Ed25519PolicySigner(signing.policy.keyId, policy.key),
        publicKeyHash: policy.publicKeyHash,
      },
      command: {
        signer: new Ed25519RemoteCommandSigner(signing.command.keyId, command.key),
        publicKeyHash: command.publicKeyHash,
      },
    };
  } catch (error) {
    if (error instanceof HubRuntimeError) throw error;
    throw new HubRuntimeError("startup_failed", "Could not open the Hub signing key snapshot.", {
      cause: error,
    });
  }
}

function assertReplacement(
  current: LoadedHubRuntimeSigner<{ readonly keyId: string }>,
  candidate: LoadedHubRuntimeSigner<{ readonly keyId: string }>,
): void {
  if (
    current.signer.keyId === candidate.signer.keyId &&
    current.publicKeyHash !== candidate.publicKeyHash
  ) {
    throw new HubRuntimeError(
      "invalid_config",
      "A new key ID is required when Hub signing key material changes.",
    );
  }
}

export function assertHubRuntimeSigningReplacement(
  current: LoadedHubRuntimeSigning,
  candidate: LoadedHubRuntimeSigning,
): void {
  assertReplacement(current.policy, candidate.policy);
  assertReplacement(current.command, candidate.command);
}

export class ReloadablePolicySigner {
  constructor(private current: LoadedHubRuntimeSigner<Ed25519PolicySigner>) {}
  get keyId(): string {
    return this.current.signer.keyId;
  }
  replace(candidate: LoadedHubRuntimeSigner<Ed25519PolicySigner>): void {
    this.current = candidate;
  }
  signSnapshot(value: Parameters<Ed25519PolicySigner["signSnapshot"]>[0]) {
    const signer = this.current.signer;
    return signer.signSnapshot(value);
  }
  signApproval(value: Parameters<Ed25519PolicySigner["signApproval"]>[0]) {
    const signer = this.current.signer;
    return signer.signApproval(value);
  }
  signRevocation(value: Parameters<Ed25519PolicySigner["signRevocation"]>[0]) {
    const signer = this.current.signer;
    return signer.signRevocation(value);
  }
}

export class ReloadableCommandSigner {
  constructor(private current: LoadedHubRuntimeSigner<Ed25519RemoteCommandSigner>) {}
  get keyId(): string {
    return this.current.signer.keyId;
  }
  replace(candidate: LoadedHubRuntimeSigner<Ed25519RemoteCommandSigner>): void {
    this.current = candidate;
  }
  sign(value: Parameters<Ed25519RemoteCommandSigner["sign"]>[0]) {
    const signer = this.current.signer;
    return signer.sign(value);
  }
}
