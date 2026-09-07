import type { NodeDiscordConversationConfig } from "./config-types.js";
import {
  configRecord,
  configText,
  exactConfigKeys,
  optionalConfigInteger,
} from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;

function boundedUniqueText(
  value: unknown,
  label: string,
  pattern: RegExp,
  minimum: number,
  maximum: number,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string" || !pattern.test(item)) ||
    new Set(value).size !== value.length
  ) {
    throw new NodeRuntimeError("invalid_config", `${label} is invalid.`);
  }
  return [...value] as string[];
}

function nullableIdentifier(value: unknown, label: string, pattern: RegExp): string | null {
  if (value === undefined || value === null) return null;
  const result = configText(value, label);
  if (!pattern.test(result)) throw new NodeRuntimeError("invalid_config", `${label} is invalid.`);
  return result;
}

export function parseDiscordConversationBehavior(input: {
  routing: unknown;
  command: unknown;
  policy: unknown;
}): Pick<NodeDiscordConversationConfig, "routing" | "command" | "policy"> {
  const routing = input.routing === undefined ? undefined : configRecord(input.routing, "routing");
  if (routing !== undefined) {
    exactConfigKeys(
      routing,
      ["readOnlyRoleId", "intent", "response"],
      "discordConversation.routing",
    );
  }
  const command = configRecord(input.command, "discordConversation.command");
  exactConfigKeys(
    command,
    ["roleId", "provider", "risk", "verificationSuiteIds", "lifetimeMs", "assignmentId", "agentId"],
    "discordConversation.command",
  );
  const roleId = configText(command.roleId, "discordConversation.command.roleId");
  const readOnlyRoleId =
    routing === undefined
      ? undefined
      : configText(routing.readOnlyRoleId, "discordConversation.routing.readOnlyRoleId");
  const intent = routing === undefined ? undefined : configRecord(routing.intent, "routing.intent");
  const response =
    routing === undefined ? undefined : configRecord(routing.response, "routing.response");
  if (intent !== undefined)
    exactConfigKeys(intent, ["provider", "model", "timeoutMs"], "routing.intent");
  if (response !== undefined) exactConfigKeys(response, ["provider", "model"], "routing.response");
  const intentModel =
    intent?.model === undefined ? undefined : configText(intent.model, "routing.intent.model");
  const responseModel =
    response?.model === undefined
      ? undefined
      : configText(response.model, "routing.response.model");
  if (
    !IDENTIFIER.test(roleId) ||
    !["codex", "claude"].includes(command.provider as string) ||
    !["low", "medium", "high"].includes(command.risk as string) ||
    !Number.isSafeInteger(command.lifetimeMs) ||
    (command.lifetimeMs as number) < 1_000 ||
    (command.lifetimeMs as number) > 300_000
  ) {
    throw new NodeRuntimeError("invalid_config", "The Discord command policy is invalid.");
  }
  if (
    routing !== undefined &&
    (readOnlyRoleId === undefined ||
      !IDENTIFIER.test(readOnlyRoleId) ||
      readOnlyRoleId === roleId ||
      !["codex", "claude"].includes(intent?.provider as string) ||
      !["codex", "claude"].includes(response?.provider as string) ||
      (intentModel !== undefined && !IDENTIFIER.test(intentModel)) ||
      (responseModel !== undefined && !IDENTIFIER.test(responseModel)))
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Discord natural-language routing must use a distinct read-only role.",
    );
  }
  const verificationSuiteIds = boundedUniqueText(
    command.verificationSuiteIds,
    "discordConversation.command.verificationSuiteIds",
    IDENTIFIER,
    1,
    16,
  );
  const assignmentId = nullableIdentifier(
    command.assignmentId,
    "discordConversation.command.assignmentId",
    /^asn_[a-f0-9]{24}$/u,
  );
  const agentId = nullableIdentifier(
    command.agentId,
    "discordConversation.command.agentId",
    /^agt_[a-f0-9]{24}$/u,
  );
  const policy = input.policy === undefined ? undefined : configRecord(input.policy, "policy");
  if (policy !== undefined) {
    exactConfigKeys(
      policy,
      ["respondTo", "cooldownSeconds", "maxResponsesPerHour", "maxAutomationDepth"],
      "discordConversation.policy",
    );
  }
  const optionalPolicy = (key: string, minimum: number, maximum: number) =>
    policy === undefined
      ? undefined
      : optionalConfigInteger(policy, key, minimum, maximum, "policy");
  const respondTo =
    policy?.respondTo === undefined
      ? (["human"] as Array<"human" | "agent">)
      : (boundedUniqueText(
          policy.respondTo,
          "discordConversation.policy.respondTo",
          /^(?:human|agent)$/u,
          1,
          2,
        ).sort() as Array<"human" | "agent">);
  const timeoutMs =
    intent === undefined
      ? undefined
      : optionalConfigInteger(intent, "timeoutMs", 1_000, 300_000, "routing.intent");
  const cooldownSeconds = optionalPolicy("cooldownSeconds", 0, 86_400);
  const maxResponsesPerHour = optionalPolicy("maxResponsesPerHour", 1, 10_000);
  const maxAutomationDepth = optionalPolicy("maxAutomationDepth", 0, 32);
  return {
    ...(routing === undefined
      ? {}
      : {
          routing: {
            readOnlyRoleId: readOnlyRoleId!,
            intent: {
              provider: intent!.provider as "codex" | "claude",
              ...(intentModel === undefined ? {} : { model: intentModel }),
              ...(timeoutMs === undefined ? {} : { timeoutMs }),
            },
            response: {
              provider: response!.provider as "codex" | "claude",
              ...(responseModel === undefined ? {} : { model: responseModel }),
            },
          },
        }),
    command: {
      roleId,
      provider: command.provider as "codex" | "claude",
      risk: command.risk as "low" | "medium" | "high",
      verificationSuiteIds,
      lifetimeMs: command.lifetimeMs as number,
      assignmentId,
      agentId,
    },
    ...(policy === undefined
      ? {}
      : {
          policy: {
            respondTo,
            ...(cooldownSeconds === undefined ? {} : { cooldownSeconds }),
            ...(maxResponsesPerHour === undefined ? {} : { maxResponsesPerHour }),
            ...(maxAutomationDepth === undefined ? {} : { maxAutomationDepth }),
          },
        }),
  };
}
