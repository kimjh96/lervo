// What a conversation's lead answered elsewhere (Lervo ADE rooms, "Mentioning across
// conversations"): each mention delivered to it in another conversation, from the rooms' schema-15
// records, so its own conversation can show "Ciel answered Iris in Log format". It reads only.
import type { EventEnvelope } from "@lervo/schemas";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";
import { MAXIMUM_ROOM_ANSWERS, type RoomAnswersResult } from "@lervo/session-host-contract";

import {
  conversationsLedBy,
  hostedLaunchRecordsPath,
  isConversationLead,
  roomSessionRecords,
} from "./hosted-launch-records.js";

/** The most records of each type one answer reads, newest first: one page of the store. */
const READ_RECORDS = 1_000;

/** Events of `type`, newest first, at most `READ_RECORDS`. */
function newest(storage: ProjectStorage, type: string): EventEnvelope[] {
  const events = storage.events;
  if (events.listNewestFirst !== undefined)
    return events.listNewestFirst({ types: [type], limit: READ_RECORDS });
  return events
    .list({ types: [type] })
    .slice(-READ_RECORDS)
    .reverse();
}

/**
 * The mentions delivered to `leadAgentId` in conversations it joined, other than `workspaceId`,
 * newest first, at most `MAXIMUM_ROOM_ANSWERS`. A conversation the agent leads shows its answers
 * itself, so `led` leaves them out: otherwise every conversation it leads repeated a line for each
 * turn of the others (2026-11-28). A mention without its delivery's receipt was never answered.
 */
export function answersElsewhere(
  storage: ProjectStorage,
  workspaceId: string,
  leadAgentId: string,
  led: ReadonlySet<string> = new Set(),
): RoomAnswersResult["answers"] {
  const delivered = new Map<string, string>();
  for (const event of newest(storage, "room.mention.delivered")) {
    const payload = event.payload as { mentionId?: unknown; occurredAt?: unknown };
    if (typeof payload.mentionId === "string" && typeof payload.occurredAt === "string")
      delivered.set(payload.mentionId, payload.occurredAt);
  }
  const answers: RoomAnswersResult["answers"] = [];
  for (const event of newest(storage, "room.mention.recorded")) {
    const payload = event.payload as Record<string, unknown>;
    const deliveredAt = delivered.get(String(payload.mentionId));
    if (
      payload.toAgentId !== leadAgentId ||
      payload.workspaceId === workspaceId ||
      led.has(String(payload.workspaceId)) ||
      typeof payload.fromAgentId !== "string" ||
      deliveredAt === undefined
    )
      continue;
    answers.push({
      mentionId: String(payload.mentionId),
      workspaceId: String(payload.workspaceId),
      fromAgentId: payload.fromAgentId,
      deliveredAt,
    });
    if (answers.length === MAXIMUM_ROOM_ANSWERS) break;
  }
  return answers.sort((left, right) => right.deliveredAt.localeCompare(left.deliveredAt));
}

/** `room.answers` for a conversation: its lead's answers elsewhere, or none without a lead. */
export async function roomAnswers(arguments_: Record<string, unknown>): Promise<RoomAnswersResult> {
  const workspaceId = arguments_.workspaceId;
  if (typeof workspaceId !== "string" || !/^wsp_[a-f0-9]{24}$/u.test(workspaceId))
    return { answers: [] };
  const path = hostedLaunchRecordsPath();
  // The lead is the session that writes; a joined agent's newer record never stands in for it.
  const lead = (await roomSessionRecords(path, workspaceId)).find((record) =>
    isConversationLead(record, workspaceId),
  );
  if (lead?.agentId === undefined) return { answers: [] };
  const led = new Set(await conversationsLedBy(path, lead.agentId));
  const repository = await resolveRegisteredRepository({
    registryPath: defaultRepositoryRegistryPath(),
    projectId: lead.projectId,
  }).catch(() => null);
  if (repository === null) return { answers: [] };
  const storage = await openProjectStorage(repository.repositoryRoot);
  try {
    return { answers: answersElsewhere(storage, workspaceId, lead.agentId, led) };
  } finally {
    await storage.close();
  }
}
