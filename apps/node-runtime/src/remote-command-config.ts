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
const ROLE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const SKILL_PATTERN = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u;

function baseTrustKeys(
  value: unknown,
  baseDirectory: string,
  kind: "command" | "policy",
): Array<{ source: Record<string, unknown>; keyId: string; publicKeyFile: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    throw new NodeRuntimeError("invalid_config", `remoteCommands.${kind}Keys is invalid.`);
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
      throw new NodeRuntimeError("invalid_config", `remoteCommands.${kind}Keys keyId is invalid.`);
    }
    seen.add(keyId);
    return {
      source: key,
      keyId,
      publicKeyFile: resolve(
        baseDirectory,
        configText(key.publicKeyFile, `${label}.publicKeyFile`),
      ),
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
      !Array.isArray(source.purposes) ||
      source.purposes.length < 1 ||
      source.purposes.length > 3 ||
      new Set(source.purposes).size !== source.purposes.length ||
      !source.purposes.every((purpose) =>
        ["snapshot", "approval", "revocation"].includes(String(purpose)),
      )
    ) {
      throw new NodeRuntimeError(
        "invalid_config",
        "remoteCommands.policyKeys purposes is invalid.",
      );
    }
    return {
      keyId,
      publicKeyFile,
      purposes: [...source.purposes] as Array<"snapshot" | "approval" | "revocation">,
    };
  });
}

export function parseRemoteCommandTrustConfig(
  value: unknown,
  baseDirectory: string,
): Pick<NonNullable<NodeRuntimeConfig["remoteCommands"]>, "commandKeys" | "policyKeys"> {
  const source = configRecord(value, "remote command trust snapshot");
  exactConfigKeys(
    source,
    ["schemaVersion", "commandKeys", "policyKeys"],
    "remote command trust snapshot",
  );
  if (source.schemaVersion !== 1) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Remote-command trust snapshot schemaVersion must be 1.",
    );
  }
  return {
    commandKeys: commandTrustKeys(source.commandKeys, baseDirectory),
    policyKeys: policyTrustKeys(source.policyKeys, baseDirectory),
  };
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
  exactConfigKeys(
    source,
    [
      "nodeId",
      "trustFile",
      "commandKeys",
      "policyKeys",
      "providerHost",
      "idlePollIntervalMs",
      "leaseDurationMs",
      "retryDelayMs",
      "limit",
      "requestTimeoutMs",
      "maxResponseBytes",
      "maxLifetimeMs",
      "clockSkewMs",
    ],
    "remoteCommands",
  );
  const nodeId = configText(source.nodeId, "remoteCommands.nodeId");
  if (!NODE_PATTERN.test(nodeId)) {
    throw new NodeRuntimeError("invalid_config", "remoteCommands.nodeId is invalid.");
  }
  const hasTrustFile = source.trustFile !== undefined;
  const hasInlineTrust = source.commandKeys !== undefined || source.policyKeys !== undefined;
  if (hasTrustFile === hasInlineTrust) {
    throw new NodeRuntimeError(
      "invalid_config",
      "remoteCommands must use exactly one of trustFile or commandKeys plus policyKeys.",
    );
  }
  let trust: Pick<
    NonNullable<NodeRuntimeConfig["remoteCommands"]>,
    "trustFile" | "commandKeys" | "policyKeys"
  >;
  if (hasTrustFile) {
    trust = {
      trustFile: resolve(baseDirectory, configText(source.trustFile, "remoteCommands.trustFile")),
    };
  } else {
    trust = {
      commandKeys: commandTrustKeys(source.commandKeys, baseDirectory),
      policyKeys: policyTrustKeys(source.policyKeys, baseDirectory),
    };
  }
  let providerHost: NonNullable<NodeRuntimeConfig["remoteCommands"]>["providerHost"];
  if (source.providerHost !== undefined) {
    const host = configRecord(source.providerHost, "remoteCommands.providerHost");
    exactConfigKeys(host, ["providers", "roles", "developerSkills"], "remoteCommands.providerHost");
    if (
      !Array.isArray(host.providers) ||
      host.providers.length < 1 ||
      host.providers.length > 2 ||
      new Set(host.providers).size !== host.providers.length ||
      host.providers.some((provider) => provider !== "codex" && provider !== "claude")
    ) {
      throw new NodeRuntimeError(
        "invalid_config",
        "remoteCommands.providerHost.providers must be a unique codex/claude allowlist.",
      );
    }
    if (
      !Array.isArray(host.roles) ||
      host.roles.length < 1 ||
      host.roles.length > 16 ||
      new Set(host.roles).size !== host.roles.length ||
      host.roles.some(
        (roleId) => typeof roleId !== "string" || roleId.length > 100 || !ROLE_PATTERN.test(roleId),
      )
    ) {
      throw new NodeRuntimeError(
        "invalid_config",
        "remoteCommands.providerHost.roles must be a unique role ID allowlist.",
      );
    }
    if (
      !Array.isArray(host.developerSkills) ||
      host.developerSkills.length > 16 ||
      new Set(host.developerSkills).size !== host.developerSkills.length ||
      host.developerSkills.some(
        (skillId) =>
          typeof skillId !== "string" || skillId.length > 150 || !SKILL_PATTERN.test(skillId),
      )
    ) {
      throw new NodeRuntimeError(
        "invalid_config",
        "remoteCommands.providerHost.developerSkills is invalid.",
      );
    }
    providerHost = {
      providers: [...host.providers] as Array<"codex" | "claude">,
      roles: [...host.roles] as string[],
      developerSkills: [...host.developerSkills] as string[],
    };
  }
  return {
    nodeId,
    ...trust,
    ...(providerHost === undefined ? {} : { providerHost }),
    ...optionalIntegers(source),
  };
}
