import { createHash } from "node:crypto";

/**
 * ADR-0563: the plan of a piece of work as a tree Lervo owns, never the agent's memory. The ledger
 * is the fold of the `plan.item.*` events, so it survives compaction and new sessions, and no item
 * is dropped for space. An item leaves the open tree only as `done` (with observed evidence),
 * `cancelled`, or `superseded`, and the reason stays recorded.
 */
export type PlanItemKind = "objective" | "directive" | "plan" | "finding";
export type PlanItemOpenState = "candidate" | "open" | "in_progress";
export type PlanItemClosedState = "done" | "cancelled" | "superseded";
export type PlanItemState = PlanItemOpenState | PlanItemClosedState;

export interface PlanItemSource {
  origin: "transcript" | "agent_command" | "workstream";
  provider: "codex" | "claude" | null;
  sessionDigest: string | null;
  transcriptOffset: number | null;
}

export interface PlanItemEvidence {
  kind: "commit" | "release" | "event";
  ref: string;
  branch: string | null;
}

export interface PlanItem {
  itemId: string;
  parentId: string | null;
  kind: PlanItemKind;
  title: string;
  state: PlanItemState;
  source: PlanItemSource;
  capturedAt: string;
  updatedAt: string;
  closed: {
    reason: string;
    evidence: PlanItemEvidence[];
    supersededBy: string | null;
    closedAt: string;
  } | null;
}

/** The ledger events in the shape the fold reads; the store passes them in sequence order. */
export type PlanLedgerEvent =
  | {
      type: "plan.item.captured";
      payload: Omit<PlanItem, "capturedAt" | "updatedAt" | "closed" | "state"> & {
        state: PlanItemOpenState;
        occurredAt: string;
      };
    }
  | {
      type: "plan.item.updated";
      payload: {
        itemId: string;
        parentId: string | null;
        title: string;
        state: PlanItemOpenState;
        occurredAt: string;
      };
    }
  | {
      type: "plan.item.closed";
      payload: {
        itemId: string;
        state: PlanItemClosedState;
        reason: string;
        evidence: PlanItemEvidence[];
        supersededBy: string | null;
        occurredAt: string;
      };
    };

export const PLAN_LEDGER_ITEM_EVENT_TYPES = [
  "plan.item.captured",
  "plan.item.updated",
  "plan.item.closed",
] as const;

export const PLAN_ITEM_ID = /^pli_[a-f0-9]{24}$/u;
export const MAXIMUM_PLAN_TITLE_LENGTH = 240;

/** A stable item id: the same capture from the same source never makes a second item. */
export function planItemId(seed: string): string {
  return `pli_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

export function planItemOpen(item: Pick<PlanItem, "state">): boolean {
  return item.state === "candidate" || item.state === "open" || item.state === "in_progress";
}

export interface PlanLedger {
  items: ReadonlyMap<string, PlanItem>;
}

/**
 * Folds ledger events in sequence order. A capture of an existing item is a replay and changes
 * nothing; an update or close of an unknown item is ignored, and nothing changes a closed item,
 * so a late or duplicated event from another host can never reopen work. A parent that would make
 * a cycle, or that does not exist, leaves the item at the root.
 */
export function foldPlanLedger(events: Iterable<PlanLedgerEvent>): PlanLedger {
  const items = new Map<string, PlanItem>();
  for (const event of events) {
    const current = items.get(event.payload.itemId);
    if (event.type === "plan.item.captured") {
      if (current !== undefined) continue;
      const { occurredAt, ...captured } = event.payload;
      items.set(captured.itemId, {
        ...captured,
        source: { ...captured.source },
        capturedAt: occurredAt,
        updatedAt: occurredAt,
        closed: null,
      });
      continue;
    }
    if (current === undefined || !planItemOpen(current)) continue;
    if (event.type === "plan.item.updated") {
      current.parentId = event.payload.parentId;
      current.title = event.payload.title;
      current.state = event.payload.state;
      current.updatedAt = event.payload.occurredAt;
      continue;
    }
    current.state = event.payload.state;
    current.updatedAt = event.payload.occurredAt;
    current.closed = {
      reason: event.payload.reason,
      evidence: event.payload.evidence.map((item) => ({ ...item })),
      supersededBy: event.payload.supersededBy,
      closedAt: event.payload.occurredAt,
    };
  }
  for (const item of items.values())
    if (item.parentId !== null && !validParent(items, item)) item.parentId = null;
  return { items };
}

function validParent(items: ReadonlyMap<string, PlanItem>, item: PlanItem): boolean {
  const seen = new Set<string>([item.itemId]);
  let parentId = item.parentId;
  while (parentId !== null) {
    if (seen.has(parentId)) return false;
    seen.add(parentId);
    const parent = items.get(parentId);
    if (parent === undefined) return false;
    parentId = parent.parentId;
  }
  return true;
}

export interface PlanLedgerLine {
  item: PlanItem;
  depth: number;
}

/**
 * The tree in display order: roots by capture time, each followed by its children. `open` keeps
 * only items still open and the ancestors that hold them, so a closed parent of open work stays
 * visible as context.
 */
export function planLedgerLines(
  ledger: PlanLedger,
  options: { open?: boolean } = {},
): PlanLedgerLine[] {
  const children = new Map<string | null, PlanItem[]>();
  for (const item of ledger.items.values()) {
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }
  for (const siblings of children.values())
    siblings.sort(
      (left, right) =>
        left.capturedAt.localeCompare(right.capturedAt) || left.itemId.localeCompare(right.itemId),
    );
  const holdsOpen = new Map<string, boolean>();
  const open = (item: PlanItem): boolean => {
    const known = holdsOpen.get(item.itemId);
    if (known !== undefined) return known;
    const value =
      planItemOpen(item) || (children.get(item.itemId) ?? []).some((child) => open(child));
    holdsOpen.set(item.itemId, value);
    return value;
  };
  const lines: PlanLedgerLine[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const item of children.get(parentId) ?? []) {
      if (options.open === true && !open(item)) continue;
      lines.push({ item, depth });
      visit(item.itemId, depth + 1);
    }
  };
  visit(null, 0);
  return lines;
}

/** One line per item, indented by depth: `- [state] title (itemId)`. */
export function formatPlanLedgerLines(lines: readonly PlanLedgerLine[]): string {
  return lines
    .map(
      ({ item, depth }) => `${"  ".repeat(depth)}- [${item.state}] ${item.title} (${item.itemId})`,
    )
    .join("\n");
}
