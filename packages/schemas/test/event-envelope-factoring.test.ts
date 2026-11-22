import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { validateSchema } from "../src/index.js";

// Exact pre-repair schema: the differential oracle must not inherit current shared constraints.
const previous = JSON.parse(
  readFileSync(new URL("./fixtures/event-envelope-before-factoring.json", import.meta.url), "utf8"),
) as {
  oneOf: Array<{ properties: { type: { enum: string[] } }; required: string[] }>;
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
});
const legacy = ajv.compile(previous);
const hash = `sha256:${"a".repeat(64)}`;
function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: "evt_factoring01",
    projectId: "prj_factoring01",
    runId: "run_factoring01",
    sessionId: "ses_factoring01",
    seq: 1,
    type: "run.requested",
    occurredAt: "2026-10-09T00:00:00Z",
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: hash,
    payload: {},
    previousHash: null,
    eventHash: hash,
    ...overrides,
  };
}
function compare(value: unknown, expected?: boolean) {
  const before = legacy(value);
  expect(validateSchema("event", value).valid).toBe(before);
  if (expected !== undefined) expect(before).toBe(expected);
}

describe("factored event envelope compatibility", () => {
  it("preserves every version/type pair, including types forbidden to earlier writers", () => {
    const allTypes = new Set(previous.oneOf.flatMap((branch) => branch.properties.type.enum));
    for (let schemaVersion = 1; schemaVersion <= 6; schemaVersion++) {
      const supported = previous.oneOf[schemaVersion - 1]!.properties.type.enum;
      for (const type of allTypes)
        compare(envelope({ schemaVersion, type }), supported.includes(type));
      compare(envelope({ schemaVersion, type: "unknown.event" }), false);
    }
  });

  it("rejects each absent required property independently in every version", () => {
    for (let schemaVersion = 1; schemaVersion <= 6; schemaVersion++) {
      for (const key of previous.oneOf[0]!.required) {
        const value = envelope({ schemaVersion });
        delete value[key];
        compare(value, false);
      }
    }
  });

  it("preserves field types, identifier/hash formats, closed properties and timestamps", () => {
    const replacements: Record<string, unknown[]> = {
      eventId: [null, 1, "evt_short", "run_factoring01"],
      projectId: [null, [], "prj_short", "evt_factoring01"],
      runId: [null, {}, "run_short", "ses_factoring01"],
      sessionId: [null, true, "ses_short", "run_factoring01"],
      seq: [null, "1", 0, -1, 1.5],
      type: [null, [], {}, 1],
      occurredAt: [null, 1, "tomorrow", "2026-10-09", "2026-10-09T99:00:00Z"],
      actor: [null, [], "system", {}, { kind: "unknown" }, { kind: "system", extra: true }],
      policyVersion: [null, 1, "sha256:bad", hash.toUpperCase()],
      payload: [null, [], "body", false],
      previousHash: ["sha256:bad", 3, {}],
      eventHash: [null, "sha256:bad", 1],
      extra: [null, "unexpected"],
    };
    for (let schemaVersion = 1; schemaVersion <= 6; schemaVersion++)
      for (const [key, values] of Object.entries(replacements))
        for (const value of values) compare(envelope({ schemaVersion, [key]: value }), false);
    compare(envelope({ occurredAt: "2026-10-09T09:00:00.123+09:00" }), true);
    compare(envelope({ payload: { retainedBySeparatePayloadOwner: true } }), true);
  });

  it("preserves sequence/predecessor and actor/provider conditional requirements", () => {
    for (let schemaVersion = 1; schemaVersion <= 6; schemaVersion++) {
      for (const seq of [1, 2, 1024])
        for (const previousHash of [null, hash])
          compare(
            envelope({ schemaVersion, seq, previousHash }),
            (seq === 1) === (previousHash === null),
          );
      for (const kind of ["user", "system", "agent", "provider"])
        for (const provider of [undefined, "codex", "claude", "unknown", null]) {
          const actor = provider === undefined ? { kind } : { kind, provider };
          compare(envelope({ schemaVersion, actor }));
        }
    }
  });

  it("rejects malformed containers and unsupported version values without coercion", () => {
    for (const value of [null, false, true, 1, "event", [], [envelope()]]) compare(value, false);
    for (const schemaVersion of [null, "1", "6", 0, -1, 1.5, 10, {}, [], true, NaN, Infinity])
      compare(envelope({ schemaVersion }), false);
  });
});
