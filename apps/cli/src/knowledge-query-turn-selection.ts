import { createHash } from "node:crypto";

import { documentIdForPath, readRepositoryFile } from "@lervo/context";
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

/** Document text a selection may hash: larger files are not documents a turn selects. */
const MAXIMUM_SELECTED_BYTES = 4 * 1024 * 1024;

/**
 * The hits as the session's own checkout holds them. A linked worktree's query ranks against the
 * registered repository's projection, but the session reads its own files, so each selection
 * names the worktree's bytes; a document the worktree lacks is not one the session could select.
 */
async function hitsInCheckout(
  hits: readonly Pick<KnowledgeQueryHit, "conceptId" | "path" | "contentHash">[],
  executionRoot: string,
): Promise<Pick<KnowledgeQueryHit, "conceptId" | "path" | "contentHash">[]> {
  const present = await Promise.all(
    hits.map(async (hit) => {
      try {
        const bytes = await readRepositoryFile(executionRoot, hit.path, MAXIMUM_SELECTED_BYTES);
        return {
          ...hit,
          contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        };
      } catch {
        return null;
      }
    }),
  );
  return present.filter((hit) => hit !== null);
}

export async function recordKnowledgeQueryTurnSelection(input: {
  /** The repository whose store holds the turn. */
  root: string;
  /** The checkout the session reads, when it is not `root`, such as a linked worktree. */
  executionRoot?: string;
  turn: OpenTerminalTurn | null;
  hits: readonly Pick<KnowledgeQueryHit, "conceptId" | "path" | "contentHash">[];
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  try {
    if (input.turn === null || input.hits.length === 0 || input.hits.length > 20) return;
    const hits =
      input.executionRoot === undefined || input.executionRoot === input.root
        ? input.hits
        : await hitsInCheckout(input.hits, input.executionRoot);
    if (hits.length === 0) return;
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
      hits.forEach((hit) => assertTerminalRepositoryRelativePath(hit.path));
      const occurredAt = new Date().toISOString();
      storage.events.transact((transaction) => {
        for (const hit of hits)
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
