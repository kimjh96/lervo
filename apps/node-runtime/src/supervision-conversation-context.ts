import type { ConversationHistoryEvidenceTurn } from "./conversation-history.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;

/** Raw conversation context stays in local CAS; only bounded exact source evidence is admitted. */
export function validSupervisionConversationContext(
  value: unknown,
): value is ConversationHistoryEvidenceTurn[] {
  if (!Array.isArray(value) || value.length > 12) return false;
  const identities = new Set<string>();
  for (const candidate of value) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate))
      return false;
    const turn = candidate as Record<string, unknown>;
    if (
      Object.keys(turn).sort().join(",") !== "role,source,speaker,text" ||
      !["user", "assistant"].includes(String(turn.role)) ||
      typeof turn.text !== "string" ||
      turn.text.length > 2_048 ||
      turn.speaker === null ||
      typeof turn.speaker !== "object" ||
      Array.isArray(turn.speaker) ||
      turn.source === null ||
      typeof turn.source !== "object" ||
      Array.isArray(turn.source)
    )
      return false;
    const speaker = turn.speaker as Record<string, unknown>;
    const source = turn.source as Record<string, unknown>;
    if (
      Object.keys(speaker).sort().join(",") !== "agentId,kind,participantId,roleId" ||
      !["human", "agent", "system"].includes(String(speaker.kind)) ||
      typeof speaker.participantId !== "string" ||
      speaker.participantId.length === 0 ||
      speaker.participantId.length > 256 ||
      !(
        speaker.agentId === null ||
        (typeof speaker.agentId === "string" &&
          speaker.agentId.length > 0 &&
          speaker.agentId.length <= 256)
      ) ||
      !(
        speaker.roleId === null ||
        (typeof speaker.roleId === "string" &&
          speaker.roleId.length > 0 &&
          speaker.roleId.length <= 256)
      ) ||
      Object.keys(source).sort().join(",") !==
        "contentHash,id,kind,observedAtMs,recordHash,roleId" ||
      !["inbound", "outbound"].includes(String(source.kind)) ||
      (turn.role === "user") !== (source.kind === "inbound") ||
      typeof source.id !== "string" ||
      source.id.length === 0 ||
      source.id.length > 256 ||
      typeof source.roleId !== "string" ||
      source.roleId.length === 0 ||
      source.roleId.length > 256 ||
      typeof source.recordHash !== "string" ||
      !HASH.test(source.recordHash) ||
      typeof source.contentHash !== "string" ||
      !HASH.test(source.contentHash) ||
      !Number.isSafeInteger(source.observedAtMs) ||
      (source.observedAtMs as number) < 0
    )
      return false;
    const identity = `${source.kind}\0${source.id}\0${source.roleId}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}
