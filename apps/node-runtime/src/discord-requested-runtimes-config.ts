import { isAbsolute, resolve } from "node:path";

import type { ConversationRequestedRuntimeTarget } from "./conversation-requested-runtime.js";
import {
  configRecord,
  configText,
  exactConfigKeys,
  optionalConfigInteger,
} from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";

function localHealthUrl(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const text = configText(value, label);
  let url: URL;
  try {
    url = new URL(text);
  } catch (error) {
    throw new NodeRuntimeError("invalid_config", `${label} is invalid.`, { cause: error });
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      `${label} must be a credential-free loopback HTTP URL.`,
    );
  }
  return url.toString();
}

export function parseDiscordRequestedRuntimes(
  value: unknown,
  baseDirectory: string,
  authorized: boolean,
): ConversationRequestedRuntimeTarget[] | undefined {
  if (value === undefined) {
    if (authorized) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Requested runtime management requires at least one configured target.",
      );
    }
    return undefined;
  }
  if (!authorized) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Requested runtime targets require the requested_runtime.manage action.",
    );
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    throw new NodeRuntimeError(
      "invalid_config",
      "discordConversation.requestedRuntimes must contain one to sixteen targets.",
    );
  }
  const targets = value.map((item, index) => {
    const label = `discordConversation.requestedRuntimes[${index}]`;
    const source = configRecord(item, label);
    exactConfigKeys(
      source,
      [
        "runtimeId",
        "displayName",
        "executable",
        "arguments",
        "workingDirectory",
        "healthUrl",
        "maximumLifetimeMs",
        "startupTimeoutMs",
        "stopTimeoutMs",
      ],
      label,
    );
    const runtimeId = configText(source.runtimeId, `${label}.runtimeId`);
    const displayName = configText(source.displayName, `${label}.displayName`);
    const executableSource = configText(source.executable, `${label}.executable`);
    const workingDirectorySource = configText(source.workingDirectory, `${label}.workingDirectory`);
    const args = source.arguments ?? [];
    if (
      !/^[a-z][a-z0-9_-]{0,63}$/u.test(runtimeId) ||
      [...displayName].length > 80 ||
      !isAbsolute(executableSource) ||
      !Array.isArray(args) ||
      args.length > 32 ||
      args.some(
        (argument) =>
          typeof argument !== "string" || argument.includes("\0") || [...argument].length > 512,
      )
    ) {
      throw new NodeRuntimeError("invalid_config", `${label} is invalid.`);
    }
    return {
      runtimeId,
      displayName,
      executable: executableSource,
      arguments: args as string[],
      workingDirectory: resolve(baseDirectory, workingDirectorySource),
      maximumLifetimeMs:
        optionalConfigInteger(source, "maximumLifetimeMs", 60_000, 86_400_000, label) ?? 28_800_000,
      startupTimeoutMs:
        optionalConfigInteger(source, "startupTimeoutMs", 100, 120_000, label) ?? 30_000,
      stopTimeoutMs: optionalConfigInteger(source, "stopTimeoutMs", 100, 30_000, label) ?? 5_000,
      ...(localHealthUrl(source.healthUrl, `${label}.healthUrl`) === undefined
        ? {}
        : { healthUrl: localHealthUrl(source.healthUrl, `${label}.healthUrl`)! }),
    };
  });
  if (new Set(targets.map((target) => target.runtimeId)).size !== targets.length) {
    throw new NodeRuntimeError(
      "invalid_config",
      "discordConversation.requestedRuntimes runtimeId values must be unique.",
    );
  }
  return targets;
}
