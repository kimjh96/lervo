import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { EventDraftV9 } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  foldPlanLedger,
  MAXIMUM_PLAN_TITLE_LENGTH,
  PLAN_ITEM_ID,
  PLAN_LEDGER_ITEM_EVENT_TYPES,
  planItemId,
  planItemOpen,
  sha256,
  type PlanItem,
  type PlanItemClosedState,
  type PlanItemEvidence,
  type PlanItemKind,
  type PlanItemOpenState,
  type PlanItemSource,
  type PlanLedger,
  type PlanLedgerEvent,
} from "@lervo/repository-knowledge";

const execute = promisify(execFile);

/** ADR-0563 events wait for the schema 9 writer, like every event a new reader must know first. */
export const PLAN_LEDGER_EVENT_SCHEMA_VERSION = 9;
const PAGE = 500;

export type PlanLedgerErrorCode =
  | "plan_ledger_inactive"
  | "plan_item_invalid"
  | "plan_item_unknown"
  | "plan_item_closed"
  | "plan_item_evidence_required"
  | "plan_item_evidence_unverified";

export class PlanLedgerError extends Error {
  constructor(
    readonly code: PlanLedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlanLedgerError";
  }
}

/** Reads every ledger event in sequence order and folds it; bounded pages, no whole-log read. */
export function readPlanLedger(storage: ProjectStorage): PlanLedger {
  const events: PlanLedgerEvent[] = [];
  let afterSeq = 0;
  for (;;) {
    const page = storage.events.list({
      afterSeq,
      limit: PAGE,
      types: PLAN_LEDGER_ITEM_EVENT_TYPES,
    });
    for (const event of page)
      events.push({ type: event.type, payload: event.payload } as PlanLedgerEvent);
    if (page.length < PAGE) break;
    afterSeq = page.at(-1)!.seq;
  }
  return foldPlanLedger(events);
}

function append(
  storage: ProjectStorage,
  type: Extract<EventDraftV9["type"], `plan.${string}`>,
  payload: Record<string, unknown>,
): string {
  if ((storage.writableEventSchemaVersion ?? 1) < PLAN_LEDGER_EVENT_SCHEMA_VERSION)
    throw new PlanLedgerError(
      "plan_ledger_inactive",
      "The plan ledger writes schema 9 events, which this repository activates once every reader supports them (`lervo upgrade`).",
    );
  const id = sha256(JSON.stringify([type, payload])).slice(7, 39);
  const eventId = `evt_${id}`;
  if (storage.events.get(eventId)) return eventId;
  storage.events.append({
    eventId,
    projectId: storage.manifest.projectId,
    runId: `run_${id}`,
    sessionId: `ses_${id}`,
    type,
    schemaVersion: PLAN_LEDGER_EVENT_SCHEMA_VERSION,
    occurredAt: String(payload.occurredAt),
    actor: { kind: "system" },
    policyVersion: sha256("lervo.plan-ledger.v1"),
    payload,
  });
  return eventId;
}

function title(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized === "" || normalized.length > MAXIMUM_PLAN_TITLE_LENGTH)
    throw new PlanLedgerError(
      "plan_item_invalid",
      `A plan item title is one line of 1 to ${MAXIMUM_PLAN_TITLE_LENGTH} characters, a short paraphrase.`,
    );
  return normalized;
}

function openItem(ledger: PlanLedger, itemId: string): PlanItem {
  const item = ledger.items.get(itemId);
  if (item === undefined)
    throw new PlanLedgerError("plan_item_unknown", `No plan item ${itemId} exists.`);
  if (!planItemOpen(item))
    throw new PlanLedgerError("plan_item_closed", `Plan item ${itemId} is already ${item.state}.`);
  return item;
}

function parent(ledger: PlanLedger, parentId: string | null): string | null {
  if (parentId === null) return null;
  if (!PLAN_ITEM_ID.test(parentId) || !ledger.items.has(parentId))
    throw new PlanLedgerError("plan_item_unknown", `No plan item ${parentId} exists.`);
  return parentId;
}

/**
 * Adds an item. The id derives from the source and title, so the same capture twice is one item,
 * and the capture of an existing item returns it unchanged.
 */
export function capturePlanItem(
  storage: ProjectStorage,
  input: {
    parentId: string | null;
    kind: PlanItemKind;
    title: string;
    state?: PlanItemOpenState;
    source: PlanItemSource;
    now?: Date;
  },
): PlanItem {
  const ledger = readPlanLedger(storage);
  const itemTitle = title(input.title);
  const parentId = parent(ledger, input.parentId);
  const itemId = planItemId(
    JSON.stringify([input.source, parentId, input.kind, itemTitle.toLowerCase()]),
  );
  const existing = ledger.items.get(itemId);
  if (existing !== undefined) return existing;
  append(storage, "plan.item.captured", {
    itemId,
    parentId,
    kind: input.kind,
    title: itemTitle,
    state: input.state ?? "open",
    source: input.source,
    occurredAt: (input.now ?? new Date()).toISOString(),
  });
  return readPlanLedger(storage).items.get(itemId)!;
}

/** Retitles, moves, or changes the open state of an item that is still open. */
export function updatePlanItem(
  storage: ProjectStorage,
  input: {
    itemId: string;
    parentId?: string | null;
    title?: string;
    state?: PlanItemOpenState;
    now?: Date;
  },
): PlanItem {
  const ledger = readPlanLedger(storage);
  const item = openItem(ledger, input.itemId);
  const parentId = input.parentId === undefined ? item.parentId : parent(ledger, input.parentId);
  if (parentId === item.itemId)
    throw new PlanLedgerError("plan_item_invalid", "A plan item cannot be its own parent.");
  append(storage, "plan.item.updated", {
    itemId: item.itemId,
    parentId,
    title: input.title === undefined ? item.title : title(input.title),
    state: input.state ?? (item.state as PlanItemOpenState),
    occurredAt: (input.now ?? new Date()).toISOString(),
  });
  return readPlanLedger(storage).items.get(item.itemId)!;
}

async function git(root: string, args: string[]): Promise<boolean> {
  try {
    await execute("git", ["-C", root, ...args], { maxBuffer: 64 * 1024 });
    return true;
  } catch {
    return false;
  }
}

/**
 * ADR-0563: `done` needs evidence Lervo observes itself. A commit must exist and be reachable
 * from the named branch (or HEAD); a release must be a tag of this repository; an event must be
 * in this repository's event store. A statement in the conversation is never evidence.
 */
async function verifyEvidence(
  storage: ProjectStorage,
  repositoryRoot: string,
  evidence: readonly PlanItemEvidence[],
): Promise<void> {
  for (const item of evidence) {
    const verified =
      item.kind === "commit"
        ? /^[a-f0-9]{7,64}$/u.test(item.ref) &&
          (await git(repositoryRoot, ["cat-file", "-e", `${item.ref}^{commit}`])) &&
          (await git(repositoryRoot, [
            "merge-base",
            "--is-ancestor",
            item.ref,
            item.branch ?? "HEAD",
          ]))
        : item.kind === "release"
          ? /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(item.ref) &&
            (await git(repositoryRoot, [
              "rev-parse",
              "--verify",
              "--quiet",
              `refs/tags/${item.ref}`,
            ]))
          : Boolean(storage.events.get(item.ref));
    if (!verified)
      throw new PlanLedgerError(
        "plan_item_evidence_unverified",
        `Lervo could not observe the ${item.kind} evidence ${item.ref}${item.branch === null ? "" : ` on ${item.branch}`}.`,
      );
  }
}

/**
 * Closes an open item. `done` requires verified evidence; `cancelled` records that the owner
 * withdrew it; `superseded` names the open or closed item that replaces it. Every close keeps its
 * reason.
 */
export async function closePlanItem(
  storage: ProjectStorage,
  input: {
    repositoryRoot: string;
    itemId: string;
    state: PlanItemClosedState;
    reason: string;
    evidence?: readonly PlanItemEvidence[];
    supersededBy?: string | null;
    now?: Date;
  },
): Promise<PlanItem> {
  const ledger = readPlanLedger(storage);
  const item = openItem(ledger, input.itemId);
  const evidence = [...(input.evidence ?? [])];
  if (input.state === "done" && evidence.length === 0)
    throw new PlanLedgerError(
      "plan_item_evidence_required",
      "A plan item closes as done only with a commit, release, or event Lervo can observe.",
    );
  await verifyEvidence(storage, input.repositoryRoot, evidence);
  const supersededBy = input.state === "superseded" ? (input.supersededBy ?? null) : null;
  if (input.state === "superseded" && (supersededBy === null || supersededBy === item.itemId))
    throw new PlanLedgerError(
      "plan_item_invalid",
      "A superseded plan item names the other item that replaces it.",
    );
  if (supersededBy !== null) parent(ledger, supersededBy);
  append(storage, "plan.item.closed", {
    itemId: item.itemId,
    state: input.state,
    reason: title(input.reason),
    evidence,
    supersededBy,
    occurredAt: (input.now ?? new Date()).toISOString(),
  });
  return readPlanLedger(storage).items.get(item.itemId)!;
}
