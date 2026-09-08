import { isAbsolute, resolve } from "node:path";

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

function providerExecutables(
  value: unknown,
  providers: readonly ("codex" | "claude")[],
): Partial<Record<"codex" | "claude", string>> | undefined {
  if (value === undefined) return undefined;
  const source = configRecord(value, "remoteCommands.providerHost.executables");
  const keys = Object.keys(source);
  if (
    keys.length < 1 ||
    keys.length > 2 ||
    keys.some((provider) => provider !== "codex" && provider !== "claude") ||
    keys.some((provider) => !providers.includes(provider as "codex" | "claude"))
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "remoteCommands.providerHost.executables must name only allowlisted providers.",
    );
  }
  const executables: Partial<Record<"codex" | "claude", string>> = {};
  for (const provider of keys as Array<"codex" | "claude">) {
    const executable = configText(
      source[provider],
      `remoteCommands.providerHost.executables.${provider}`,
    );
    if (!isAbsolute(executable) || /[\0\r\n]/u.test(executable)) {
      throw new NodeRuntimeError(
        "invalid_config",
        "A managed provider executable must be a safe absolute path.",
      );
    }
    executables[provider] = executable;
  }
  return executables;
}

function providerModels(
  value: unknown,
  providers: readonly ("codex" | "claude")[],
): Partial<Record<"codex" | "claude", string>> | undefined {
  if (value === undefined) return undefined;
  const source = configRecord(value, "remoteCommands.providerHost.models");
  const keys = Object.keys(source) as Array<"codex" | "claude">;
  if (
    keys.length < 1 ||
    keys.length > 2 ||
    keys.some((provider) => !["codex", "claude"].includes(provider)) ||
    keys.some((provider) => !providers.includes(provider))
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "remoteCommands.providerHost.models must name only allowlisted providers.",
    );
  }
  return Object.fromEntries(
    keys.map((provider) => [
      provider,
      configText(source[provider], `remoteCommands.providerHost.models.${provider}`),
    ]),
  );
}

function providerReasoningEfforts(
  value: unknown,
  providers: readonly ("codex" | "claude")[],
): Partial<Record<"codex" | "claude", "low" | "medium" | "high" | "xhigh" | "max">> | undefined {
  if (value === undefined) return undefined;
  const source = configRecord(value, "remoteCommands.providerHost.reasoningEfforts");
  const keys = Object.keys(source) as Array<"codex" | "claude">;
  if (
    keys.length < 1 ||
    keys.length > 2 ||
    keys.some((provider) => !["codex", "claude"].includes(provider)) ||
    keys.some((provider) => !providers.includes(provider)) ||
    keys.some(
      (provider) => !["low", "medium", "high", "xhigh", "max"].includes(source[provider] as string),
    )
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "remoteCommands.providerHost.reasoningEfforts must name valid efforts for allowlisted providers.",
    );
  }
  return { ...source } as Partial<
    Record<"codex" | "claude", "low" | "medium" | "high" | "xhigh" | "max">
  >;
}

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
    exactConfigKeys(
      host,
      ["providers", "roles", "developerSkills", "executables", "models", "reasoningEfforts"],
      "remoteCommands.providerHost",
    );
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
    const providers = [...host.providers] as Array<"codex" | "claude">;
    const executables = providerExecutables(host.executables, providers);
    const models = providerModels(host.models, providers);
    const reasoningEfforts = providerReasoningEfforts(host.reasoningEfforts, providers);
    providerHost = {
      providers,
      roles: [...host.roles] as string[],
      developerSkills: [...host.developerSkills] as string[],
      ...(executables === undefined ? {} : { executables }),
      ...(models === undefined ? {} : { models }),
      ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }),
    };
  }
  return {
    nodeId,
    ...trust,
    ...(providerHost === undefined ? {} : { providerHost }),
    ...optionalIntegers(source),
  };
}
