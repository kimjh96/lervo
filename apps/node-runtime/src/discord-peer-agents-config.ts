import type { NodeDiscordConversationConfig } from "./config-types.js";
import { configRecord, configText, exactConfigKeys } from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const PARTICIPANT_KEY = /^(?:bot|user|webhook):[0-9]{1,32}$/u;
const PARTICIPANT_ID = /^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const AGENT_ID = /^agt_[a-f0-9]{24}$/u;
const ROLE_VERSION =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;

function uniqueTextList(value: unknown, label: string, pattern: RegExp): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 64 ||
    value.some((item) => typeof item !== "string" || !pattern.test(item)) ||
    new Set(value).size !== value.length
  ) {
    throw new NodeRuntimeError("invalid_config", `${label} is invalid.`);
  }
  return [...value] as string[];
}

function conversationPriorities(
  value: unknown,
  label: string,
  conversationIds: readonly string[],
): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  const source = configRecord(value, label);
  if (
    Object.keys(source).length < 1 ||
    Object.keys(source).length > 64 ||
    Object.entries(source).some(
      ([conversationId, priority]) =>
        !conversationIds.includes(conversationId) ||
        !Number.isSafeInteger(priority) ||
        Number(priority) < 0 ||
        Number(priority) > 100,
    )
  ) {
    throw new NodeRuntimeError("invalid_config", `${label} is invalid.`);
  }
  return Object.fromEntries(
    Object.entries(source)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([conversationId, priority]) => [conversationId, Number(priority)]),
  );
}

export function parseDiscordPeerAgents(
  value: unknown,
  scope: {
    allowedTenantKeys: readonly string[];
    conversations: NodeDiscordConversationConfig["conversations"];
    ownParticipantId: string;
    ownAgentId?: string;
    ownParticipantKeys: readonly string[];
    manualParticipants: NodeDiscordConversationConfig["participants"];
  },
): NodeDiscordConversationConfig["peerAgents"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new NodeRuntimeError("invalid_config", "discordConversation.peerAgents is invalid.");
  }
  const peers = value.map((item, index) => {
    const label = `discordConversation.peerAgents[${index}]`;
    const source = configRecord(item, label);
    exactConfigKeys(
      source,
      [
        "participantKeys",
        "participantId",
        "roleId",
        "displayName",
        "unaddressedPriority",
        "unaddressedPriorities",
        "agentBinding",
        "tenantKeys",
        "conversationIds",
      ],
      label,
    );
    const participantKeys = uniqueTextList(
      source.participantKeys,
      `${label}.participantKeys`,
      PARTICIPANT_KEY,
    );
    const participantId = configText(source.participantId, `${label}.participantId`);
    const roleId = configText(source.roleId, `${label}.roleId`);
    const displayName =
      source.displayName === undefined
        ? undefined
        : configText(source.displayName, `${label}.displayName`);
    const unaddressedPriority = source.unaddressedPriority;
    const agent = configRecord(source.agentBinding, `${label}.agentBinding`);
    exactConfigKeys(
      agent,
      ["agentId", "roleVersion", "roleContractHash", "roleProfileHash"],
      `${label}.agentBinding`,
    );
    const agentBinding = {
      agentId: configText(agent.agentId, `${label}.agentBinding.agentId`),
      roleVersion: configText(agent.roleVersion, `${label}.agentBinding.roleVersion`),
      roleContractHash: configText(
        agent.roleContractHash,
        `${label}.agentBinding.roleContractHash`,
      ),
      roleProfileHash: configText(agent.roleProfileHash, `${label}.agentBinding.roleProfileHash`),
    };
    const tenantKeys = uniqueTextList(
      source.tenantKeys,
      `${label}.tenantKeys`,
      /^(?:dm|[0-9]{1,32})$/u,
    );
    const conversationIds = uniqueTextList(
      source.conversationIds,
      `${label}.conversationIds`,
      /^cnv_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u,
    );
    const unaddressedPriorities = conversationPriorities(
      source.unaddressedPriorities,
      `${label}.unaddressedPriorities`,
      conversationIds,
    );
    if (
      !PARTICIPANT_ID.test(participantId) ||
      !IDENTIFIER.test(roleId) ||
      (displayName !== undefined &&
        (displayName.length > 80 ||
          displayName.trim() !== displayName ||
          /[\u0000-\u001f\u007f@]/u.test(displayName))) ||
      (unaddressedPriority !== undefined &&
        (!Number.isSafeInteger(unaddressedPriority) ||
          Number(unaddressedPriority) < 0 ||
          Number(unaddressedPriority) > 100)) ||
      !AGENT_ID.test(agentBinding.agentId) ||
      !ROLE_VERSION.test(agentBinding.roleVersion) ||
      !HASH.test(agentBinding.roleContractHash) ||
      !HASH.test(agentBinding.roleProfileHash) ||
      participantId === scope.ownParticipantId ||
      agentBinding.agentId === scope.ownAgentId ||
      tenantKeys.some((tenantKey) => !scope.allowedTenantKeys.includes(tenantKey)) ||
      conversationIds.some(
        (conversationId) =>
          !scope.conversations.some(
            (conversation) =>
              conversation.conversationId === conversationId &&
              tenantKeys.includes(conversation.tenantKey),
          ),
      ) ||
      participantKeys.some((participantKey) => scope.ownParticipantKeys.includes(participantKey)) ||
      scope.manualParticipants.some(
        (participant) =>
          tenantKeys.includes(participant.tenantKey) &&
          participantKeys.includes(
            `${participant.actorKind === "agent" ? "bot" : "user"}:${participant.userId}`,
          ),
      )
    ) {
      throw new NodeRuntimeError("invalid_config", "A Discord peer-agent binding is invalid.");
    }
    return {
      participantKeys,
      participantId,
      roleId,
      ...(displayName === undefined ? {} : { displayName }),
      ...(unaddressedPriority === undefined
        ? {}
        : { unaddressedPriority: Number(unaddressedPriority) }),
      ...(unaddressedPriorities === undefined ? {} : { unaddressedPriorities }),
      agentBinding,
      tenantKeys,
      conversationIds,
    };
  });
  if (
    new Set(peers.map((peer) => peer.participantId)).size !== peers.length ||
    new Set(peers.map((peer) => peer.agentBinding.agentId)).size !== peers.length ||
    new Set(
      peers.flatMap((peer) =>
        peer.tenantKeys.flatMap((tenantKey) =>
          peer.participantKeys.map((participantKey) => `${tenantKey}\0${participantKey}`),
        ),
      ),
    ).size !==
      peers.reduce((count, peer) => count + peer.tenantKeys.length * peer.participantKeys.length, 0)
  ) {
    throw new NodeRuntimeError("invalid_config", "Discord peer-agent bindings must be unique.");
  }
  return peers;
}
