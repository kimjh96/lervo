import { expect, it } from "vitest";
import { validateSchema } from "../src/validate.js";

it("keeps returned enum errors from changing later event validation", () => {
  const event = {
    eventId: "evt_abcdefgh",
    projectId: "prj_abcdefgh",
    runId: "run_abcdefgh",
    sessionId: "ses_abcdefgh",
    type: "context.quality.prepared",
    schemaVersion: 6,
    occurredAt: "2026-10-11T00:00:00Z",
    actor: { kind: "system" },
    seq: 1,
    previousHash: null,
    eventHash: `sha256:${"0".repeat(64)}`,
    policyVersion: `sha256:${"0".repeat(64)}`,
    payload: {},
  };
  expect(validateSchema("event", event).valid).toBe(true);
  const invalid = { ...event, type: "diagnostic.invalid" };
  const result = validateSchema("event", invalid);
  expect(result.valid).toBe(false);
  const error = result.errors.find(
    (entry) =>
      entry.keyword === "enum" &&
      entry.instancePath === "/type" &&
      (entry.params.allowedValues as string[]).includes(event.type),
  );
  expect(error).toBeDefined();
  const allowed = error!.params.allowedValues as string[];
  const originalLength = allowed.length;
  const expectedErrors = structuredClone(result.errors);
  try {
    allowed.push(invalid.type);
    expect(validateSchema("event", invalid)).toEqual({ valid: false, errors: expectedErrors });
    allowed.splice(allowed.indexOf(event.type), 1);
    expect(validateSchema("event", event).valid).toBe(true);
  } finally {
    // Restore the original oracle when this regression runs before the repair.
    allowed.splice(originalLength);
    if (!allowed.includes(event.type)) allowed.push(event.type);
  }
});
