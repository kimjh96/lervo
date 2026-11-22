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
const PARENT_REFERENCE_PATTERN = "^p(?:[1-9]|[12][0-9]|3[0-2])$";
const PARENT_REFERENCE = new RegExp(PARENT_REFERENCE_PATTERN, "u");

export const planItemsResponseSchema = providerOutputSchema({
  type: "array",
  maxItems: MAXIMUM_CAPTURED_PLAN_ITEMS,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["directive", "plan", "finding"] },
      title: { type: "string", minLength: 1, maxLength: 240 },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      parent: { anyOf: [{ type: "null" }, { type: "string", pattern: PARENT_REFERENCE_PATTERN }] },
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

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum)
    throw new TypeError("The capture assessment planItems.title is invalid.");
  return value.replace(/\s+/gu, " ").trim();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value))
    throw new TypeError(`The capture assessment ${field} is invalid.`);
  return value as T;
}

/** The plan items of a response; a response without the field states none. */
export function parseCapturedPlanItems(value: unknown): CapturedPlanItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAXIMUM_CAPTURED_PLAN_ITEMS)
    throw new TypeError("The capture assessment planItems is invalid.");
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw new TypeError("The capture assessment planItems entry is invalid.");
    const item = entry as Record<string, unknown>;
    const keys = Object.keys(item).sort().join(",");
    if (keys !== "confidence,kind,parent,title")
      throw new TypeError("The capture assessment planItems entry has unsupported fields.");
    if (
      item.parent !== null &&
      (typeof item.parent !== "string" || !PARENT_REFERENCE.test(item.parent))
    )
      throw new TypeError("The capture assessment planItems.parent is invalid.");
    return {
      kind: oneOf(item.kind, ["directive", "plan", "finding"], "planItems.kind"),
      title: text(item.title, 240),
      confidence: oneOf(item.confidence, ["high", "medium", "low"], "planItems.confidence"),
      parent: item.parent as string | null,
    };
  });
}
