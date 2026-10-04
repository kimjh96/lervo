import { existsSync } from "node:fs";
import { sha256 } from "@lervo/repository-knowledge";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { ordinaryConvergenceSourceBytes } from "./source-file.js";

export const HISTORY_ACCEPTANCE_PATH = ".lervo/knowledge/history-acceptance.json";

/** Owner-authored decision that exact historical change obligations need no semantic audit. */
export interface HistoricalAcceptance {
  schemaVersion: 1;
  projectId: string;
  disposition: "owner_accepted";
  decidedAt: string;
  rationale: string;
  events: { eventId: string; eventHash: string }[];
}

const HASH = /^sha256:[a-f0-9]{64}$/u;

/**
 * Accepted history never claims semantic coverage; it only closes the exact listed obligations.
 * An absent file accepts nothing, and a malformed file fails closed.
 */
export function loadHistoricalAcceptance(
  root: string,
  projectId: string,
): { contentHash: string; accepted: Set<string> } | null {
  if (!existsSync(`${root}/${HISTORY_ACCEPTANCE_PATH}`)) return null;
  const bytes = ordinaryConvergenceSourceBytes(root, HISTORY_ACCEPTANCE_PATH, 4 * 1024 * 1024);
  let value: HistoricalAcceptance;
  try {
    value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as typeof value;
  } catch (error) {
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid", { cause: error });
  }
  if (
    value?.schemaVersion !== 1 ||
    value.projectId !== projectId ||
    value.disposition !== "owner_accepted" ||
    typeof value.decidedAt !== "string" ||
    Number.isNaN(Date.parse(value.decidedAt)) ||
    typeof value.rationale !== "string" ||
    value.rationale.trim().length < 20 ||
    !Array.isArray(value.events) ||
    value.events.length > 20_000 ||
    value.events.some(
      (event) =>
        typeof event?.eventId !== "string" ||
        !/^evt_[a-z0-9]+$/u.test(event.eventId) ||
        !HASH.test(event.eventHash ?? ""),
    )
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  return {
    contentHash: sha256(bytes),
    accepted: new Set(value.events.map((event) => `${event.eventId}\0${event.eventHash}`)),
  };
}

export const historicalAcceptanceKey = (event: { eventId: string; eventHash: string }) =>
  `${event.eventId}\0${event.eventHash}`;
