import { describe, expect, it } from "vitest";

import {
  managedConversationTurnInstructions,
  managedConversationTurnOutputSchema,
  parseManagedConversationTurn,
} from "../src/managed-turn-contract.js";

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
        schemaVersion: { type: "integer", const: 2 },
      },
    });
    expect(findUntypedProperties(schema)).toEqual([]);
  });

  it("drops a redundant repository-work argument without changing the requested effect", () => {
    expect(
      parseManagedConversationTurn(
        {
          schemaVersion: 2,
          intent: "continue_work",
          confidence: "high",
          participation: "relevant",
          effect: { kind: "repository_work", argument: "redundant copy of the request" },
          deliveryRelation: "standalone",
          reply: null,
        },
        [],
        2_000,
      ),
    ).toMatchObject({ effect: { kind: "repository_work", argument: null } });
  });

  it("routes live read-only inspection through native repository work", () => {
    const instructions = managedConversationTurnInstructions({
      request: {
        event: {
          actor: { kind: "human" },
        },
        mentioned: false,
        respondingAgent: { agentId: null, roleId: "developer" },
        policy: { roleId: "developer" },
        surfaceEffects: [],
      } as never,
      message: "현재 원격 브랜치 상태를 실제로 확인해 주세요.",
      plan: {
        role: { roleId: "developer" },
        executionIdentity: {},
      } as never,
    });

    expect(instructions).toContain(
      "Use continue_work for live inspection or verification as well as repository, deployment, or surface mutations",
    );
    expect(instructions).toContain("Read-only native work may complete with zero changed paths.");
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
