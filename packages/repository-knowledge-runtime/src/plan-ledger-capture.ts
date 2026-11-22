import type { ProjectStorage } from "@lervo/project-storage";
import {
  MAXIMUM_OPEN_PLAN_ITEMS_IN_CAPTURE,
  parseCapturedPlanItems,
  planItemOpen,
  planLedgerLines,
  resolvePlanItemReference,
  type OpenPlanItemContext,
} from "@lervo/repository-knowledge";

import {
  capturePlanItem,
  PLAN_LEDGER_EVENT_SCHEMA_VERSION,
  readPlanLedger,
} from "./plan-ledger-store.js";

/**
 * ADR-0563 S2: the open items an owner-turn assessment sees, in-progress first, so it attaches new
 * work under them and omits work they already cover. A ledger that cannot be read gives none.
 */
export function openPlanItemsForCapture(storage: ProjectStorage): OpenPlanItemContext[] {
  try {
    const open = planLedgerLines(readPlanLedger(storage), { open: true })
      .map(({ item }) => item)
      .filter(planItemOpen);
    return [
      ...open.filter((item) => item.state === "in_progress"),
      ...open.filter((item) => item.state !== "in_progress"),
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
 * ADR-0563 S2: writes the work an assessment found open. Explicit work (`high` confidence) is
 * open; anything less certain is a candidate, which the S3 cross-check confirms. The parent is
 * the shown open item the assessment cited by its `p<n>` reference; any other reference leaves the
 * item at the root. Before schema 9 is active nothing is written; an item that cannot be written
 * never fails rule capture.
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
  let capturedCount = 0;
  for (const item of items) {
    try {
      capturePlanItem(input.storage, {
        parentId: resolvePlanItemReference(input.shown, item.parent)?.itemId ?? null,
        kind: item.kind,
        title: item.title,
        state: item.confidence === "high" ? "open" : "candidate",
        source: {
          origin: "transcript",
          provider: input.provider,
          sessionDigest: null,
          transcriptOffset: null,
        },
        now: input.now,
      });
      capturedCount += 1;
    } catch {
      // A closed parent or an out-of-bounds title skips this item only.
    }
  }
  return { status: "captured", capturedCount };
}
