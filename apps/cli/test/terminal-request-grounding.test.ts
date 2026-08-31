import { describe, expect, it } from "vitest";

import { semanticResolutionFailureDecision } from "@lervo/request-grounding";

import { GroundProductionRequestError } from "../src/semantic-grounding.js";
import { resolveTerminalRequestGrounding } from "../src/terminal-request-grounding.js";

describe("direct terminal request grounding", () => {
  it("degrades a typed provider adapter failure to an empty abstain decision", async () => {
    const decision = await resolveTerminalRequestGrounding({
      request: "뭐가 문제일까요",
      provider: "codex",
      currentWorkstream: null,
      services: {
        groundProductionRequest: async () => {
          throw new GroundProductionRequestError(new TypeError("invalid nested reference"));
        },
      },
    });

    expect(decision).toMatchObject({
      ...semanticResolutionFailureDecision(),
      ambiguityReasons: ["semantic_resolution_failed"],
      durableInstruction: { disposition: "none" },
    });
  });

  it("bounds provider resolution below the outer hook timeout", async () => {
    let timeoutMs: number | undefined;
    await resolveTerminalRequestGrounding({
      request: "Inspect the repository.",
      provider: "codex",
      currentWorkstream: null,
      services: {
        groundProductionRequest: async (input) => {
          timeoutMs = input.timeoutMs;
          return {
            proposal: {
              resolver: { resultDigest: `sha256:${"b".repeat(64)}` },
              ambiguityReasons: [],
              durableInstruction: {
                disposition: "none",
                speechAct: "other",
                authority: "inferred",
                durability: "unspecified",
                operation: "none",
                scope: { kind: "unspecified", paths: [] },
                title: null,
                statement: null,
                exceptions: [],
                risk: "unknown",
                conflict: "unknown",
                confidence: "low",
                reasonIds: [],
              },
            } as never,
            decision: semanticResolutionFailureDecision(),
          };
        },
      },
    });

    expect(timeoutMs).toBe(10_000);
  });

  it("forwards bounded current-workstream context to semantic grounding", async () => {
    let observedCurrentWorkstream: unknown;
    await resolveTerminalRequestGrounding({
      request: "그 기준을 유지해줘",
      provider: "codex",
      currentWorkstream: {
        workstreamId: `wks_${"1".repeat(24)}`,
        revision: 7,
        context: "Current objective: qualify lexical-v2 without weakening gates.",
      },
      services: {
        groundProductionRequest: async (input) => {
          observedCurrentWorkstream = input.resolutionContext.currentWorkstream;
          return {
            proposal: {
              resolver: { resultDigest: `sha256:${"b".repeat(64)}` },
              ambiguityReasons: [],
              durableInstruction: {
                disposition: "none",
                speechAct: "other",
                authority: "inferred",
                durability: "unspecified",
                operation: "none",
                scope: { kind: "unspecified", paths: [] },
                title: null,
                statement: null,
                exceptions: [],
                risk: "unknown",
                conflict: "unknown",
                confidence: "low",
                reasonIds: [],
              },
            } as never,
            decision: semanticResolutionFailureDecision(),
          };
        },
      },
    });

    expect(observedCurrentWorkstream).toEqual({
      workstreamId: `wks_${"1".repeat(24)}`,
      revision: 7,
      context: "Current objective: qualify lexical-v2 without weakening gates.",
    });
  });

  it("does not hide failures outside the provider grounding boundary", async () => {
    await expect(
      resolveTerminalRequestGrounding({
        request: "Inspect the repository.",
        provider: "codex",
        currentWorkstream: null,
        services: {
          groundProductionRequest: async () => {
            throw new Error("repository storage failed");
          },
        },
      }),
    ).rejects.toThrow("repository storage failed");
  });
});
