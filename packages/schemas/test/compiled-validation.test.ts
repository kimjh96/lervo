import { Ajv2020 } from "ajv/dist/2020.js";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { schemaCatalog, schemaReferences, type SchemaName } from "../src/schema-catalog.js";
import { validateSchema } from "../src/validate.js";

// The runtime compiler's previous settings and date format are the differential oracle.
const legacy = new Ajv2020({ allErrors: true, strict: true });
legacy.addFormat("date-time", {
  type: "string",
  validate: (value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
});
for (const schema of schemaReferences) legacy.addSchema(schema);
const previous = Object.fromEntries(
  Object.entries(schemaCatalog).map(([name, schema]) => [name, legacy.compile(schema)]),
);

function compare(name: SchemaName, value: unknown) {
  const validator = previous[name]!;
  const valid = validator(value);
  expect(validateSchema(name, value), name).toEqual({
    valid,
    errors: validator.errors ? [...validator.errors] : [],
  });
}

interface Fixture {
  name: string;
  schema: SchemaName;
  value: unknown;
}
const directory = new URL("./fixtures/", import.meta.url);
const fixtures = readdirSync(directory)
  .filter((name) => /^(?:valid|invalid)(?:-|\.)/.test(name) && name.endsWith(".json"))
  .flatMap((name) => JSON.parse(readFileSync(new URL(name, directory), "utf8")) as Fixture[]);

describe("generated validator equivalence", () => {
  it("preserves every registered schema on malformed and primitive inputs", () => {
    for (const name of Object.keys(schemaCatalog) as SchemaName[])
      for (const value of [null, false, 0, "", [], {}, { schemaVersion: 1 }]) compare(name, value);
  });

  for (const fixture of fixtures) {
    it(`preserves verdicts and errors for ${fixture.name}`, () => {
      compare(fixture.schema, fixture.value);
      if (!fixture.value || typeof fixture.value !== "object" || Array.isArray(fixture.value))
        return;
      for (const key of Object.keys(fixture.value)) {
        const missing = { ...fixture.value } as Record<string, unknown>;
        delete missing[key];
        compare(fixture.schema, missing);
        compare(fixture.schema, { ...fixture.value, [key]: null });
        compare(fixture.schema, { ...fixture.value, [key]: { unexpected: true } });
      }
    });
  }

  it("validates in a process that forbids runtime code generation", () => {
    const artifact = new URL("../dist/generated/validators.js", import.meta.url);
    const output = execFileSync(
      process.execPath,
      [
        "--disallow-code-generation-from-strings",
        "--input-type=module",
        "-e",
        `const {default: validators} = await import(${JSON.stringify(artifact.href)}); if (validators.event(null)) throw new Error("invalid event accepted"); console.log(Object.keys(validators).length);`,
      ],
      { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
    );
    expect(Number(output.trim())).toBe(Object.keys(schemaCatalog).length);
  });
});
