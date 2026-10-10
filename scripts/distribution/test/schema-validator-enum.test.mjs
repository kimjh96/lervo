import { createRequire } from "node:module";
const { Ajv2020 } = createRequire(
  new URL("../../../packages/schemas/package.json", import.meta.url),
)("ajv/dist/2020.js");
import { expect, it } from "vitest";
import { installPrimitiveEnumIndex } from "../../../packages/schemas/scripts/primitive-enum-keyword.mjs";
import { enumContains } from "../../../packages/schemas/src/validation-enum.ts";

function compare(schema, values, options = {}) {
  const reference = new Ajv2020({ allErrors: true, strict: true, loopEnum: 3, ...options });
  const indexed = new Ajv2020({ allErrors: true, strict: true, loopEnum: 3, ...options });
  installPrimitiveEnumIndex(indexed);
  const before = reference.compile(schema);
  const after = indexed.compile(schema);
  for (const value of values) {
    expect(after(value)).toBe(before(value));
    expect(after.errors).toEqual(before.errors);
  }
}

it("preserves primitive membership and errors without coercion", () => {
  const values = Object.freeze([null, true, false, 0, 1, "1", "value"]);
  const probes = [...values, -0, undefined, NaN, Infinity, "missing", {}, [], Object(1)];
  compare({ enum: values }, probes);
  for (const value of probes) expect(enumContains(value, values)).toBe(values.includes(value));
  const other = Object.freeze(["other", 2, 3]);
  expect(enumContains("value", other)).toBe(false);
  expect(enumContains("value", values)).toBe(true);
});

it("keeps deep equality and short lists on the original compiler path", () => {
  compare({ enum: [{ enabled: true }, ["one"], "tail"] }, [
    { enabled: true },
    { enabled: false },
    ["one"],
    ["two"],
    "tail",
    null,
  ]);
  compare({ enum: [0, "zero"] }, [0, -0, "zero", "0", false, null]);
});

it("does not retain request-defined enum values", () => {
  compare(
    {
      type: "object",
      properties: { allowed: { type: "array" }, value: { enum: { $data: "1/allowed" } } },
      required: ["allowed", "value"],
    },
    [
      { allowed: ["one", "two", "three"], value: "one" },
      { allowed: ["two", "three", "four"], value: "one" },
      { allowed: [{ nested: true }, null, 0], value: { nested: true } },
      { allowed: [], value: "one" },
    ],
    { $data: true },
  );
});
