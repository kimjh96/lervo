import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type SchemaName, validateSchema } from "../src/index.js";

interface Fixture {
  name: string;
  schema: SchemaName;
  value: unknown;
}

function loadFixtures(name: "invalid" | "valid"): Fixture[] {
  return [
    `${name}.json`,
    `${name}-m0-governance.json`,
    `${name}-shared-context.json`,
    `${name}-deliberation.json`,
    `${name}-deliberation-event.json`,
    `${name}-writing.json`,
    `${name}-writing-publication.json`,
    `${name}-document-format.json`,
    `${name}-document-migration-apply.json`,
    `${name}-document-staleness.json`,
    `${name}-legacy-registry-migration.json`,
    `${name}-managed-block-patch.json`,
    `${name}-verification.json`,
  ].flatMap((fileName) => {
    const fixtureUrl = new URL(`./fixtures/${fileName}`, import.meta.url);
    return JSON.parse(readFileSync(fixtureUrl, "utf8")) as Fixture[];
  });
}

describe("M0 JSON Schema fixtures", () => {
  for (const fixture of loadFixtures("valid")) {
    it(`accepts ${fixture.name}`, () => {
      expect(validateSchema(fixture.schema, fixture.value)).toEqual({
        valid: true,
        errors: [],
      });
    });
  }

  for (const fixture of loadFixtures("invalid")) {
    it(`rejects ${fixture.name}`, () => {
      const result = validateSchema(fixture.schema, fixture.value);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  }
});
