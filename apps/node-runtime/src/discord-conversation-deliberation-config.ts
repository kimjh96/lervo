import { resolve } from "node:path";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import {
  configRecord,
  configText,
  exactConfigKeys,
  optionalConfigInteger,
} from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";

const PERMISSIONS = new Set(["deliberation.start", "deliberation.resume", "deliberation.read"]);

export function parseDiscordConversationDeliberation(
  value: unknown,
  baseDirectory: string,
  humanParticipantIds: readonly string[],
): NodeDiscordConversationConfig["deliberation"] {
  if (value === undefined) return undefined;
  const source = configRecord(value, "discordConversation.deliberation");
  exactConfigKeys(
    source,
    [
      "cliExecutable",
      "workerId",
      "principals",
      "pollIntervalMs",
      "leaseDurationMs",
      "maxRecords",
      "processTimeoutMs",
    ],
    "discordConversation.deliberation",
  );
  if (
    !Array.isArray(source.principals) ||
    source.principals.length < 1 ||
    source.principals.length > 64
  ) {
    throw new NodeRuntimeError("invalid_config", "Discord deliberation principals are invalid.");
  }
  const principals = source.principals.map((value, index) => {
    const principal = configRecord(value, `deliberation.principals[${index}]`);
    exactConfigKeys(
      principal,
      ["participantId", "principalId", "permissions"],
      `deliberation.principals[${index}]`,
    );
    const participantId = configText(
      principal.participantId,
      `deliberation.principals[${index}].participantId`,
    );
    const principalId = configText(
      principal.principalId,
      `deliberation.principals[${index}].principalId`,
    );
    if (
      !humanParticipantIds.includes(participantId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(principalId) ||
      !Array.isArray(principal.permissions) ||
      principal.permissions.length < 1 ||
      principal.permissions.length > 3 ||
      new Set(principal.permissions).size !== principal.permissions.length ||
      principal.permissions.some((permission) => !PERMISSIONS.has(String(permission)))
    ) {
      throw new NodeRuntimeError("invalid_config", "Discord deliberation principals are invalid.");
    }
    return {
      participantId,
      principalId,
      permissions: [...principal.permissions].sort() as Array<
        "deliberation.start" | "deliberation.resume" | "deliberation.read"
      >,
    };
  });
  if (new Set(principals.map((item) => item.participantId)).size !== principals.length) {
    throw new NodeRuntimeError("invalid_config", "Discord deliberation principals must be unique.");
  }
  const workerId = configText(source.workerId, "discordConversation.deliberation.workerId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(workerId)) {
    throw new NodeRuntimeError("invalid_config", "Discord deliberation worker ID is invalid.");
  }
  const integer = (key: string, minimum: number, maximum: number) =>
    optionalConfigInteger(source, key, minimum, maximum, "discordConversation.deliberation");
  const pollIntervalMs = integer("pollIntervalMs", 100, 60_000);
  const leaseDurationMs = integer("leaseDurationMs", 1_000, 3_600_000);
  const maxRecords = integer("maxRecords", 1, 1_000_000);
  const processTimeoutMs = integer("processTimeoutMs", 1_000, 3_600_000);
  return {
    cliExecutable: resolve(
      baseDirectory,
      configText(source.cliExecutable, "discordConversation.deliberation.cliExecutable"),
    ),
    workerId,
    principals,
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
    ...(leaseDurationMs === undefined ? {} : { leaseDurationMs }),
    ...(maxRecords === undefined ? {} : { maxRecords }),
    ...(processTimeoutMs === undefined ? {} : { processTimeoutMs }),
  };
}
