import { resolve } from "node:path";

import { type NodeRuntimeConfig } from "./config-types.js";
import {
  configRecord,
  configText,
  exactConfigKeys,
  optionalConfigInteger,
} from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";

const NODE_PATTERN = /^node_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const KEY_PATTERN = /^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u;

function baseTrustKeys(
  value: unknown,
  baseDirectory: string,
  kind: "command" | "policy",
): Array<{ source: Record<string, unknown>; keyId: string; publicKeyFile: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    throw new NodeRuntimeError("invalid_config", `remoteCommands.${kind}Keys가 유효하지 않습니다.`);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const label = `remoteCommands.${kind}Keys[${index}]`;
    const key = configRecord(item, label);
    exactConfigKeys(
      key,
      kind === "policy" ? ["keyId", "publicKeyFile", "purposes"] : ["keyId", "publicKeyFile"],
      label,
    );
    const keyId = configText(key.keyId, `${label}.keyId`);
    if (!KEY_PATTERN.test(keyId) || seen.has(keyId)) {
      throw new NodeRuntimeError("invalid_config", `remoteCommands.${kind}Keys keyId가 유효하지 않습니다.`);
    }
    seen.add(keyId);
    return {
      source: key,
      keyId,
      publicKeyFile: resolve(baseDirectory, configText(key.publicKeyFile, `${label}.publicKeyFile`)),
    };
  });
}

function commandTrustKeys(value: unknown, baseDirectory: string) {
  return baseTrustKeys(value, baseDirectory, "command").map(({ keyId, publicKeyFile }) => ({
    keyId,
    publicKeyFile,
  }));
}

function policyTrustKeys(value: unknown, baseDirectory: string) {
  return baseTrustKeys(value, baseDirectory, "policy").map(({ source, keyId, publicKeyFile }) => {
    if (
      !Array.isArray(source.purposes) || source.purposes.length < 1 || source.purposes.length > 3 ||
      new Set(source.purposes).size !== source.purposes.length ||
      !source.purposes.every((purpose) =>
        ["snapshot", "approval", "revocation"].includes(String(purpose))
      )
    ) {
      throw new NodeRuntimeError("invalid_config", "remoteCommands.policyKeys purposes가 유효하지 않습니다.");
    }
    return {
      keyId,
      publicKeyFile,
      purposes: [...source.purposes] as Array<"snapshot" | "approval" | "revocation">,
    };
  });
}

function optionalIntegers(source: Record<string, unknown>) {
  const bounds = {
    idlePollIntervalMs: [100, 60 * 60_000],
    leaseDurationMs: [1_000, 5 * 60_000],
    retryDelayMs: [1_000, 60 * 60_000],
    limit: [1, 16],
    requestTimeoutMs: [10, 300_000],
    maxResponseBytes: [1_024, 16_777_216],
    maxLifetimeMs: [0, 15 * 60_000],
    clockSkewMs: [0, 60_000],
  } as const;
  const output: Record<string, number> = {};
  for (const [key, [minimum, maximum]] of Object.entries(bounds)) {
    const value = optionalConfigInteger(source, key, minimum, maximum, "remoteCommands");
    if (value !== undefined) output[key] = value;
  }
  return output;
}

export function parseRemoteCommandConfig(
  value: unknown,
  baseDirectory: string,
): NonNullable<NodeRuntimeConfig["remoteCommands"]> {
  const source = configRecord(value, "remoteCommands");
  exactConfigKeys(source, [
    "nodeId",
    "commandKeys",
    "policyKeys",
    "idlePollIntervalMs",
    "leaseDurationMs",
    "retryDelayMs",
    "limit",
    "requestTimeoutMs",
    "maxResponseBytes",
    "maxLifetimeMs",
    "clockSkewMs",
  ], "remoteCommands");
  const nodeId = configText(source.nodeId, "remoteCommands.nodeId");
  if (!NODE_PATTERN.test(nodeId)) {
    throw new NodeRuntimeError("invalid_config", "remoteCommands.nodeId가 유효하지 않습니다.");
  }
  return {
    nodeId,
    commandKeys: commandTrustKeys(source.commandKeys, baseDirectory),
    policyKeys: policyTrustKeys(source.policyKeys, baseDirectory),
    ...optionalIntegers(source),
  };
}
