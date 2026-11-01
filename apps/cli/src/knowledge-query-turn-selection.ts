import { documentIdForPath } from "@lervo/context";
import { openProjectStorage } from "@lervo/project-storage";
import type { KnowledgeQueryHit } from "@lervo/repository-knowledge";

import {
  assertTerminalRepositoryRelativePath,
  terminalEventDraft,
} from "./terminal-event-coordinates.js";
import {
  openTurnCoordinates,
  queryOpenTerminalTurn,
  type OpenTerminalTurn,
} from "./terminal-open-turns.js";

export async function recordKnowledgeQueryTurnSelection(input: {
  root: string;
  turn: OpenTerminalTurn | null;
  hits: readonly Pick<KnowledgeQueryHit, "conceptId" | "path" | "contentHash">[];
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  try {
    if (input.turn === null || input.hits.length === 0 || input.hits.length > 20) return;
    const turn = await queryOpenTerminalTurn(input.root, input.env);
    if (turn === null || JSON.stringify(turn) !== JSON.stringify(input.turn)) return;
    const storage = await openProjectStorage(input.root);
    try {
      const coordinates = openTurnCoordinates(turn);
      const context = storage.events.get(turn.contextEventId);
      if (
        context?.type !== "terminal.context.prepared" ||
        context.actor.kind !== "provider" ||
        context.runId !== coordinates.runId ||
        context.sessionId !== coordinates.sessionId ||
        context.actor.provider !== turn.provider ||
        context.payload.providerSessionDigest !== turn.providerSessionDigest ||
        context.payload.providerTurnDigest !== turn.providerTurnDigest
      )
        return;
      const laterTurns = storage.events.list({
        runId: coordinates.runId,
        afterSeq: context.seq,
        types: ["terminal.turn.observed"],
        limit: 1000,
      });
      if (
        laterTurns.length === 1000 ||
        laterTurns.some((event) => event.payload.contextEventId === turn.contextEventId)
      )
        return;
      input.hits.forEach((hit) => assertTerminalRepositoryRelativePath(hit.path));
      const occurredAt = new Date().toISOString();
      storage.events.transact((transaction) => {
        for (const hit of input.hits)
          transaction.append(
            terminalEventDraft({
              projectId: storage.manifest.projectId,
              coordinates,
              provider: turn.provider,
              actorKind: "agent",
              type: "context.selected",
              occurredAt,
              payload: {
                origin: "agent_query",
                documentId: documentIdForPath(hit.path),
                conceptId: hit.conceptId,
                path: hit.path,
                contentHash: hit.contentHash,
                providerSessionDigest: turn.providerSessionDigest,
                providerTurnDigest: turn.providerTurnDigest,
                contextEventId: turn.contextEventId,
              },
            }),
          );
      });
    } finally {
      await storage.close();
    }
  } catch {
    // Query observations are best effort; query output and exit status keep their own contract.
  }
}
