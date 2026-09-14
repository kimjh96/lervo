/** Bounded reasons why the canonical intake writer refused to bind one supervised request. */
export type SupervisionRequestRefusalCode =
  | "request_invalid"
  | "identity_conflict"
  | "workstream_inactive"
  | "origin_conflict"
  | "authority_changed"
  | "evidence_changed"
  | "owner_busy";

const REFUSAL_CODES: ReadonlySet<string> = new Set<SupervisionRequestRefusalCode>([
  "request_invalid",
  "identity_conflict",
  "workstream_inactive",
  "origin_conflict",
  "authority_changed",
  "evidence_changed",
  "owner_busy",
]);

/** A refusal wrote nothing: no event, no artifact, and no provider effect. */
export class SupervisionRequestRefusedError extends Error {
  readonly code: SupervisionRequestRefusalCode;

  constructor(code: SupervisionRequestRefusalCode, message: string) {
    super(message);
    this.name = "SupervisionRequestRefusedError";
    this.code = code;
  }
}

/** Returns the bounded refusal code, or null for any failure whose canonical effect is uncertain. */
export function supervisionRequestRefusalCode(
  error: unknown,
): SupervisionRequestRefusalCode | null {
  if (
    error instanceof SupervisionRequestRefusedError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "SupervisionRequestRefusedError" &&
      REFUSAL_CODES.has(String((error as { code?: unknown }).code)))
  )
    return (error as SupervisionRequestRefusedError).code;
  return null;
}
