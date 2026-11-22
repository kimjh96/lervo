import type { ProjectStorage } from "@lervo/project-storage";
import {
  MAXIMUM_OPEN_PLAN_ITEMS_IN_CAPTURE,
  parseCapturedPlanItems,
  planItemOpen,
  resolvePlanItemReference,
  sanitizePracticeText,
  type OpenPlanItemContext,
  type PlanItem,
} from "@lervo/repository-knowledge";

import {
  capturePlanItem,
  PLAN_LEDGER_EVENT_SCHEMA_VERSION,
  readPlanLedger,
  updatePlanItem,
} from "./plan-ledger-store.js";

/**
 * At most this many unconfirmed candidates stay open. Past it a new candidate is dropped, so an
 * owner turn or an untrusted agent turn can never flood the ledger; explicit work still lands.
 */
export const MAXIMUM_OPEN_PLAN_CANDIDATES = 64;

function key(parentId: string | null, title: string): string {
  return `${parentId ?? ""}\0${title.replace(/\s+/gu, " ").trim().toLowerCase()}`;
}

/**
 * ADR-0563 S2: the open items an owner-turn assessment sees, so it attaches new work under them
 * and omits work they already cover: in-progress items first, then the most recently changed, so
 * new work stays visible however many older items remain open. A ledger that cannot be read gives
 * none.
 */
export function openPlanItemsForCapture(storage: ProjectStorage): OpenPlanItemContext[] {
  try {
    const open = [...readPlanLedger(storage).items.values()].filter(planItemOpen);
    const recent = (left: PlanItem, right: PlanItem) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.itemId.localeCompare(right.itemId);
    return [
      ...open.filter((item) => item.state === "in_progress").sort(recent),
      ...open.filter((item) => item.state !== "in_progress").sort(recent),
    ]
      .slice(0, MAXIMUM_OPEN_PLAN_ITEMS_IN_CAPTURE)
      .map(({ itemId, kind, title }) => ({ itemId, kind, title }));
  } catch {
    return [];
  }
}

export interface PlanItemCaptureResult {
  status: "captured" | "inactive" | "invalid";
  capturedCount: number;
}

/**
 * ADR-0563 S2: writes the work an assessment found open, once per assessed owner turn.
 * - Explicit work (`high` confidence) is open; anything less certain is a candidate, which the S3
 *   cross-check confirms, and at most 64 candidates stay open.
 * - The parent is the shown open item the assessment cited by its `p<n>` reference; any other
 *   reference leaves the item at the root.
 * - An open item with the same parent and title, from any source or of any kind, is the same
 *   work: nothing new is written, and an explicit restatement confirms a candidate.
 * - A title the practice sanitizer would change (a secret, a credential, a home path) is dropped.
 * Before schema 9 is active nothing is written; an item that cannot be written never fails rule
 * capture.
 */
export function capturePlanItemsFromAssessment(input: {
  storage: ProjectStorage;
  response: unknown;
  provider: "codex" | "claude";
  /** The open items the assessment was shown, in the order of their references. */
  shown: readonly OpenPlanItemContext[];
  now: Date;
}): PlanItemCaptureResult {
  if ((input.storage.writableEventSchemaVersion ?? 1) < PLAN_LEDGER_EVENT_SCHEMA_VERSION)
    return { status: "inactive", capturedCount: 0 };
  let items;
  try {
    items = parseCapturedPlanItems((input.response as { planItems?: unknown } | null)?.planItems);
  } catch {
    return { status: "invalid", capturedCount: 0 };
  }
  let open: PlanItem[];
  try {
    open = [...readPlanLedger(input.storage).items.values()].filter(planItemOpen);
  } catch {
    return { status: "invalid", capturedCount: 0 };
  }
  const byKey = new Map(open.map((item) => [key(item.parentId, item.title), item]));
  let candidates = open.filter((item) => item.state === "candidate").length;
  let capturedCount = 0;
  for (const item of items) {
    if (sanitizePracticeText(item.title) !== item.title) continue;
    const parentId = resolvePlanItemReference(input.shown, item.parent)?.itemId ?? null;
    const state = item.confidence === "high" ? "open" : "candidate";
    try {
      const existing = byKey.get(key(parentId, item.title));
      if (existing !== undefined) {
        if (existing.state === "candidate" && state === "open") {
          updatePlanItem(input.storage, { itemId: existing.itemId, state: "open", now: input.now });
          existing.state = "open";
          candidates -= 1;
        }
        continue;
      }
      if (state === "candidate" && candidates >= MAXIMUM_OPEN_PLAN_CANDIDATES) continue;
      const captured = capturePlanItem(input.storage, {
        parentId,
        kind: item.kind,
        title: item.title,
        state,
        source: {
          origin: "transcript",
          provider: input.provider,
          sessionDigest: null,
          transcriptOffset: null,
        },
        now: input.now,
      });
      byKey.set(key(parentId, captured.title), captured);
      if (captured.state === "candidate") candidates += 1;
      capturedCount += 1;
    } catch {
      // A parent that no longer exists or a write that failed skips this item only.
    }
  }
  return { status: "captured", capturedCount };
}
