import type { NodeDiscordConversationConfig } from "./config-types.js";
import { configRecord, configText, exactConfigKeys } from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";

const POLICY_ID = /^deliberation_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const ROLE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export function parseDiscordDeliberationParticipation(
  value: unknown,
): NodeDiscordConversationConfig["deliberationParticipation"] {
  if (value === undefined) return undefined;
  const source = configRecord(value, "discordConversation.deliberationParticipation");
  exactConfigKeys(source, ["routes"], "discordConversation.deliberationParticipation");
  if (!Array.isArray(source.routes) || source.routes.length < 1 || source.routes.length > 32) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Discord deliberation participation routes are invalid.",
    );
  }
  const routes = source.routes.map((value, index) => {
    const label = `discordConversation.deliberationParticipation.routes[${index}]`;
    const route = configRecord(value, label);
    exactConfigKeys(
      route,
      ["policyId", "policyRoleId", "provider", "model", "reasoningEffort"],
      label,
    );
    const policyId = configText(route.policyId, `${label}.policyId`);
    const policyRoleId = configText(route.policyRoleId, `${label}.policyRoleId`);
    if (!POLICY_ID.test(policyId) || !ROLE_ID.test(policyRoleId)) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Discord deliberation participation routes are invalid.",
      );
    }
    const provider =
      route.provider === undefined ? undefined : configText(route.provider, `${label}.provider`);
    const model = route.model === undefined ? undefined : configText(route.model, `${label}.model`);
    const reasoningEffort =
      route.reasoningEffort === undefined
        ? undefined
        : configText(route.reasoningEffort, `${label}.reasoningEffort`);
    if (
      (provider !== undefined && !["codex", "claude"].includes(provider)) ||
      (model !== undefined && (model.length > 128 || /[\0\r\n]/u.test(model))) ||
      (reasoningEffort !== undefined &&
        !["low", "medium", "high", "xhigh", "max"].includes(reasoningEffort))
    ) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Discord deliberation participation execution routes are invalid.",
      );
    }
    return {
      policyId,
      policyRoleId,
      ...(provider === undefined ? {} : { provider: provider as "codex" | "claude" }),
      ...(model === undefined ? {} : { model }),
      ...(reasoningEffort === undefined
        ? {}
        : {
            reasoningEffort: reasoningEffort as "low" | "medium" | "high" | "xhigh" | "max",
          }),
    };
  });
  if (
    new Set(routes.map((route) => `${route.policyId}\0${route.policyRoleId}`)).size !==
    routes.length
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Discord deliberation participation routes must be unique.",
    );
  }
  return { routes };
}
