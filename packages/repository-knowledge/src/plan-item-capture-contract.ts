import { providerOutputSchema } from "@lervo/schemas";

/**
 * ADR-0563 S2: the plan items an owner-turn assessment returns, and the open items it is shown.
 * The provider never sees or writes a ledger id (ADR-0604, ADR-0608): it sees each open item as a
 * short reference `p1` to `p32` and cites one as `parent`; the runtime maps it back to the item it
 * showed under that reference.
 */
export interface CapturedPlanItem {
  kind: "directive" | "plan" | "finding";
  title: string;
  confidence: "high" | "medium" | "low";
  /** The `p<n>` reference of the shown open item this item belongs under, or null. */
  parent: string | null;
}

/** An open ledger item the runtime may show an assessment. */
export interface OpenPlanItemContext {
  itemId: string;
  kind: string;
  title: string;
}

export const MAXIMUM_CAPTURED_PLAN_ITEMS = 8;
export const MAXIMUM_OPEN_PLAN_ITEMS_IN_CAPTURE = 32;
const PARENT_REFERENCE = /^p(?:[1-9]|[12][0-9]|3[0-2])$/u;

/**
 * The wire schema states the shape only. Bounds live in the parser, which drops an out-of-bounds
 * item alone: a provider that enforces structured output strictly then never fails or retries the
 * whole call, and with it rule capture, over one plan item.
 */
export const planItemsResponseSchema = providerOutputSchema({
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["directive", "plan", "finding"] },
      title: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      parent: { type: ["string", "null"] },
    },
    required: ["kind", "title", "confidence", "parent"],
  },
} as const);

/** What the assessment sees of the open items: a reference, a kind, and a title, never an id. */
export function planItemCaptureContext(
  items: readonly OpenPlanItemContext[],
): Array<{ reference: string; kind: string; title: string }> {
  return items
    .slice(0, MAXIMUM_OPEN_PLAN_ITEMS_IN_CAPTURE)
    .map((item, index) => ({ reference: `p${index + 1}`, kind: item.kind, title: item.title }));
}

/** The shown item a `p<n>` reference names, or null for no reference or one that names nothing. */
export function resolvePlanItemReference(
  items: readonly OpenPlanItemContext[],
  reference: string | null,
): OpenPlanItemContext | null {
  if (reference === null || !PARENT_REFERENCE.test(reference)) return null;
  return items.slice(0, MAXIMUM_OPEN_PLAN_ITEMS_IN_CAPTURE)[Number(reference.slice(1)) - 1] ?? null;
}

/** One item, or null when it is out of bounds or not well-formed. */
function planItem(entry: unknown): CapturedPlanItem | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
  const item = entry as Record<string, unknown>;
  if (Object.keys(item).sort().join(",") !== "confidence,kind,parent,title") return null;
  const { kind, title, confidence, parent } = item;
  if (kind !== "directive" && kind !== "plan" && kind !== "finding") return null;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") return null;
  if (typeof title !== "string") return null;
  const normalized = title.replace(/\s+/gu, " ").trim();
  if (normalized === "" || normalized.length > 240) return null;
  if (parent !== null && (typeof parent !== "string" || !PARENT_REFERENCE.test(parent)))
    return null;
  return { kind, title: normalized, confidence, parent: parent as string | null };
}

/**
 * The plan items of a response: at most eight well-formed ones, in order. A response without the
 * field states none; a malformed item is dropped alone; only a value that is not a list fails.
 */
export function parseCapturedPlanItems(value: unknown): CapturedPlanItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("The capture assessment planItems is invalid.");
  return value
    .map(planItem)
    .filter((item): item is CapturedPlanItem => item !== null)
    .slice(0, MAXIMUM_CAPTURED_PLAN_ITEMS);
}
