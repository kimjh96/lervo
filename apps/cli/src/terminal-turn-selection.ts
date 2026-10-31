import { documentIdForPath } from "@lervo/context";
import type { ProjectStorage } from "@lervo/project-storage";
import { validateSchema, type EventEnvelope } from "@lervo/schemas";

import { assertTerminalRepositoryRelativePath } from "./terminal-event-coordinates.js";

export interface SelectedTerminalDocument {
  documentId: string;
  conceptId?: string;
  path: string;
  contentHash: string;
}

export function selectedTerminalDocuments(
  events: ProjectStorage["events"],
  context: EventEnvelope,
): SelectedTerminalDocument[] {
  const documents = new Map<string, SelectedTerminalDocument>();
  const pointers = context.payload.selectedPointers;
  if (Array.isArray(pointers))
    for (const pointer of pointers) {
      const item = pointer as { path: string; contentHash: string };
      assertTerminalRepositoryRelativePath(item.path);
      documents.set(item.path, {
        path: item.path,
        contentHash: item.contentHash,
        documentId: documentIdForPath(item.path),
      });
    }
  let afterSeq = context.seq;
  while (true) {
    const batch = events.list({
      runId: context.runId,
      types: ["context.selected"],
      afterSeq,
      limit: 1000,
    });
    for (const event of batch) {
      const payload = event.payload;
      if (
        event.type !== "context.selected" ||
        event.actor.kind !== "agent" ||
        payload.origin !== "agent_query" ||
        event.actor.provider !== context.actor.provider ||
        event.sessionId !== context.sessionId ||
        payload.contextEventId !== context.eventId ||
        payload.providerSessionDigest !== context.payload.providerSessionDigest ||
        payload.providerTurnDigest !== context.payload.providerTurnDigest ||
        !validateSchema("contextSelectedEventPayload", payload).valid
      )
        continue;
      const path = payload.path as string;
      assertTerminalRepositoryRelativePath(path);
      documents.set(path, {
        documentId: payload.documentId as string,
        ...(typeof payload.conceptId === "string" ? { conceptId: payload.conceptId } : {}),
        path,
        contentHash: payload.contentHash as string,
      });
    }
    if (batch.length < 1000) break;
    afterSeq = batch.at(-1)!.seq;
  }
  return [...documents.values()];
}
