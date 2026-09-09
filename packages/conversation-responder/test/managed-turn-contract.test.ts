import { describe, expect, it } from "vitest";

import { managedConversationTurnOutputSchema } from "../src/index.js";

describe("managed conversation turn output contract", () => {
  it("declares a type for every object property in the strict response schema", () => {
    const schema = managedConversationTurnOutputSchema([
      {
        effectId: "channel.rename",
        description: "Rename the current channel.",
        argumentDescription: "The new channel name.",
      },
    ]);

    expect(schema).toMatchObject({
      type: "object",
      properties: {
        schemaVersion: { type: "integer", const: 1 },
      },
    });
    expect(findUntypedProperties(schema)).toEqual([]);
  });
});

function findUntypedProperties(schema: unknown, path = "$schema"): string[] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return [];
  }
  const body = schema as Record<string, unknown>;
  const properties = body.properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return [];
  }
  return Object.entries(properties).flatMap(([name, propertySchema]) => {
    const propertyPath = `${path}.properties.${name}`;
    if (
      typeof propertySchema !== "object" ||
      propertySchema === null ||
      Array.isArray(propertySchema)
    ) {
      return [propertyPath];
    }
    const propertyBody = propertySchema as Record<string, unknown>;
    return [
      ...(propertyBody.type === undefined ? [propertyPath] : []),
      ...findUntypedProperties(propertyBody, propertyPath),
    ];
  });
}
