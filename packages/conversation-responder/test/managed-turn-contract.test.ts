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
        schemaVersion: { type: "integer", const: 3 },
      },
    });
    expect(findUntypedProperties(schema)).toEqual([]);
  });

  it("drops a redundant repository-work argument without changing the requested effect", () => {
    expect(
      parseManagedConversationTurn(
        {
          schemaVersion: 3,
          intent: "continue_work",
          confidence: "high",
          participation: "relevant",
          effect: { kind: "repository_work", argument: "redundant copy of the request" },
          executionProfile: "routine",
          deliveryRelation: "standalone",
          reply: null,
        },
        [],
        2_000,
      ),
    ).toMatchObject({
      effect: { kind: "repository_work", argument: null },
      executionProfile: "routine",
    });
  });

  it("routes live read-only inspection through native repository work", () => {
    const instructions = managedConversationTurnInstructions({
      request: {
        event: {
          actor: { kind: "human" },
        },
        mentioned: false,
        respondingAgent: {
          participantId: "ptc_lervoagent",
          agentId: null,
          roleId: "developer",
        },
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
    expect(instructions).toContain(
      "never answer that live work cannot be performed because this turn cannot write",
    );
    expect(instructions).toContain("Read-only native work may complete with zero changed paths.");
  });

  it("distinguishes a durable supervised goal from one bounded repository task", () => {
    const effect = {
      effectId: "supervision_goal_request",
      description: "Ask the installed owner to govern a durable multi-step outcome.",
      argumentDescription: null,
    };
    expect(
      parseManagedConversationTurn(
        {
          schemaVersion: 3,
          intent: "continue_work",
          confidence: "high",
          participation: "relevant",
          effect: { kind: "supervision_goal_request", argument: null },
          executionProfile: null,
          deliveryRelation: "standalone",
          reply:
            "I understand that this release must proceed through implementation, verification, and deployment.",
        },
        [effect],
        2_000,
      ),
    ).toMatchObject({
      effect: { kind: "supervision_goal_request", argument: null },
      reply:
        "I understand that this release must proceed through implementation, verification, and deployment.",
    });

    const instructions = managedConversationTurnInstructions({
      request: {
        event: { actor: { kind: "human" } },
        mentioned: false,
        respondingAgent: {
          participantId: "ptc_lervoagent",
          agentId: null,
          roleId: "product-owner",
        },
        policy: { roleId: "product-owner" },
        surfaceEffects: [effect],
      } as never,
      message: "Take this through implementation, verification, and deployment.",
      plan: { role: { roleId: "product-owner" }, executionIdentity: {} } as never,
    });
    expect(instructions).toContain("durable multi-step outcome");
    expect(instructions).toContain("grounded in the exact request and current context");
    expect(instructions).toContain("Do not claim that admission succeeded");
  });

  it("rejects a supervision goal without a request-grounded acknowledgment", () => {
    expect(() =>
      parseManagedConversationTurn(
        {
          schemaVersion: 3,
          intent: "continue_work",
          confidence: "high",
          participation: "relevant",
          effect: { kind: "supervision_goal_request", argument: null },
          executionProfile: null,
          deliveryRelation: "standalone",
          reply: null,
        },
        [
          {
            effectId: "supervision_goal_request",
            description: "Ask the installed owner to govern a durable multi-step outcome.",
            argumentDescription: null,
          },
        ],
        2_000,
      ),
    ).toThrow(/reply conflicts/iu);
  });

  it("gives a matching governed discussion action precedence over repository work", () => {
    const instructions = managedConversationTurnInstructions({
      request: {
        event: { actor: { kind: "human" } },
        mentioned: false,
        respondingAgent: {
          participantId: "ptc_lervoagent",
          agentId: null,
          roleId: "product-owner",
        },
        policy: { roleId: "product-owner" },
        surfaceEffects: [
          {
            effectId: "deliberation_start",
            description: "Convene independently bound agents and synthesize one decision.",
            argumentDescription: "The complete topic.",
          },
        ],
      } as never,
      message:
        "Ask two installed agents to review the deployment independently and converge on one decision.",
      plan: { role: { roleId: "product-owner" }, executionIdentity: {} } as never,
    });

    expect(instructions).toContain(
      "do not replace that action with repository_work merely because its topic concerns a repository, deployment, verification, or another external system",
    );
    expect(instructions).toContain(
      "Starting that governed discussion is the requested surface action, not repository_work",
    );
  });

  it("requires a coordinator to advance an incomplete delegated result", () => {
    const instructions = managedConversationTurnInstructions({
      request: {
        event: {
          actor: { kind: "agent" },
          coordination: {
            kind: "task.result",
            taskId: `tsk_${"q".repeat(20)}`,
            coordinatorParticipantId: "ptc_lervoagent",
          },
        },
        mentioned: true,
        respondingAgent: {
          participantId: "ptc_lervoagent",
          agentId: null,
          roleId: "ceo",
        },
        policy: { roleId: "ceo" },
        surfaceEffects: [],
      } as never,
      message: "The status is known, but the requested fix has not been applied.",
      plan: { role: { roleId: "ceo" }, executionIdentity: {} } as never,
    });

    expect(instructions).toContain("do not stop at repeating the status report");
    expect(instructions).toContain("complete original human outcome in priorTurns");
  });

  it("normalizes a redundant acknowledgement around an authority-checked surface action", () => {
    expect(
      parseManagedConversationTurn(
        {
          schemaVersion: 3,
          intent: "answer",
          confidence: "high",
          participation: "relevant",
          effect: { kind: "deliberation_start", argument: "Compare two independent reviews." },
          executionProfile: null,
          deliveryRelation: "reply",
          reply: "I will start the discussion.",
        },
        [
          {
            effectId: "deliberation_start",
            description: "Convene independently bound agents and synthesize one decision.",
            argumentDescription: "The complete topic.",
          },
        ],
        2_000,
      ),
    ).toMatchObject({
      intent: "continue_work",
      effect: { kind: "deliberation_start", argument: "Compare two independent reviews." },
      executionProfile: null,
      deliveryRelation: "standalone",
      reply: null,
    });
  });

  it("keeps a maximum-size effect choice catalog separate from its bounded description", () => {
    const argumentChoices = Array.from({ length: 64 }, (_, index) => ({
      value: `ptc_agent_${String(index).padStart(2, "0")}`,
      label: `Named agent ${index} (product-owner)`,
    }));
    const effect = {
      effectId: "workforce_task_delegate",
      description: "Delegate one bounded task to an exact routable peer.",
      argumentDescription:
        "Compact JSON with participantId equal to one argumentChoices value and a bounded task.",
      argumentChoices,
      maximumArgumentCharacters: 1_024,
    };

    expect(() => managedConversationTurnOutputSchema([effect])).not.toThrow();
    const instructions = JSON.parse(
      managedConversationTurnInstructions({
        request: {
          event: { actor: { kind: "human" } },
          mentioned: false,
          respondingAgent: {
            participantId: "ptc_lervoagent",
            agentId: null,
            roleId: "product-owner",
          },
          policy: { roleId: "product-owner" },
          surfaceEffects: [effect],
        } as never,
        message: "Delegate this to named agent 63.",
        plan: { role: { roleId: "product-owner" }, executionIdentity: {} } as never,
      }),
    ) as {
      instruction: string[];
      surfaceEffects: Array<{ argumentChoices: typeof argumentChoices }>;
    };
    expect(instructions.surfaceEffects[0]?.argumentChoices).toEqual(argumentChoices);
    expect(instructions.instruction.join(" ")).toContain("durable role, context");
    expect(instructions.instruction.join(" ")).toContain("do not assign a synthetic");
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
