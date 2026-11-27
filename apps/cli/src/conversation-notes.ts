// An agent's own note after a turn another agent's mention delivered to it (Lervo ADE rooms,
// "Memory from conversation"; ADR-0648): what it committed to, learned, or decided, in its own
// words from the last message it published, attested by the delivery's receipt. The note is
// written off the turn's answer path, bounded in time, never more than one per delivered turn,
// and a failure writes nothing and changes nothing else.
import { conversationNoteSubject } from "@lervo/agent-organization";
import { coordinationEventSchemaVersion } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";

import { promoteAgentContext } from "./agent-context-promotion.js";
import { clipAtWord, ownWords } from "./conversation-note-text.js";

/** How long a note lasts. */
const NOTE_DAYS = 30;
/** How long a note may take before the room stops waiting for it. */
const NOTE_DEADLINE_MS = 10_000;

/** What the room knows when a delivered turn ends. */
export interface ConversationNote {
  readonly repositoryRoot: string;
  /** The agent the mention was delivered to, whose note this is. */
  readonly agentId: string;
  readonly workspaceId: string;
  readonly mentionId: string;
  /** The receipt's event: the delivery's `room.mention.delivered`. */
  readonly receiptEventId: string;
  /** The last message the agent published in the turn. */
  readonly text: string;
}

/**
 * `empty` is a message with no words of the agent's own once its code and quotes are dropped; it
 * writes nothing.
 */
export type ConversationNoteOutcome = "recorded" | "inactive" | "unavailable" | "empty";

/** The note's words: the agent's own words in the message, cut at a word within the limit. */
export function noteSummary(text: string): string {
  return clipAtWord(ownWords(text));
}

function within<T>(work: Promise<T>, deadlineMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("conversation_note_deadline")), deadlineMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Records the note, or nothing below event schema 16. It never throws: a note its receipt cannot
 * attest yet, a busy store, or the deadline answers `unavailable`.
 */
export async function writeConversationNote(
  note: ConversationNote,
  now = new Date(),
): Promise<ConversationNoteOutcome> {
  const summary = noteSummary(note.text);
  if (summary.length === 0) return "empty";
  try {
    const storage = await openProjectStorage(note.repositoryRoot);
    let writable: number;
    let contentHash: string | undefined;
    try {
      writable = storage.writableEventSchemaVersion ?? 1;
      contentHash = storage.events.get(note.receiptEventId)?.eventHash;
    } finally {
      await storage.close();
    }
    if (writable < coordinationEventSchemaVersion) return "inactive";
    if (contentHash === undefined) return "unavailable";
    await within(
      promoteAgentContext(note.repositoryRoot, {
        agentId: note.agentId,
        layer: "work",
        memoryKind: "conversation_note",
        subjectKey: conversationNoteSubject(
          note.workspaceId,
          note.mentionId.slice("mnt_".length, "mnt_".length + 12),
        ),
        retrievalTerms: ["conversation note"],
        confidence: "medium",
        sensitivity: "internal",
        source: { kind: "event", sourceId: note.receiptEventId, contentHash },
        reviewEventId: note.receiptEventId,
        summary,
        expiresAt: new Date(now.getTime() + NOTE_DAYS * 86_400_000).toISOString(),
        now,
      }),
      NOTE_DEADLINE_MS,
    );
    return "recorded";
  } catch {
    return "unavailable";
  }
}
