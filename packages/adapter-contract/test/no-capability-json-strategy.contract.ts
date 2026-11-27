import { dirname } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NoCapabilityInvocationFailure,
  type NoCapabilityJsonInvocationStrategy,
} from "../src/index.js";

/** One provider's native output for the same structured result and usage. */
export interface NoCapabilityJsonStrategyFixtures {
  /** A completed run that returned `result` and reported usage. */
  completed(result: Record<string, unknown>): string;
  /** A run that returned `result` after a tool or capability event. */
  usedTool(result: Record<string, unknown>): string;
  nativeFailureEvent: Record<string, unknown>;
  successEvent: Record<string, unknown>;
}

const request = {
  workingDirectory: "/private/run",
  responseSchema: { requested: '{"type":"object"}', nativeSubset: '{"type":"object"}' },
  model: "contract-model",
};

/** The common suite every provider's no-capability JSON strategy passes. */
export function describeNoCapabilityJsonStrategyContract(
  strategy: NoCapabilityJsonInvocationStrategy,
  fixtures: NoCapabilityJsonStrategyFixtures,
): void {
  describe(`${strategy.provider} no-capability JSON strategy contract`, () => {
    it("declares the capabilities it disables and how admission proves none remain", () => {
      expect(strategy.disabledCapabilities.length).toBeGreaterThan(0);
      expect(strategy.usageSemanticsId.startsWith(`${strategy.provider}.`)).toBe(true);
      expect(["model_input", "model_call"]).toContain(strategy.admission.kind);
    });

    it("builds deterministic runs whose files stay inside the private directory", () => {
      const runs = [
        strategy.instructedRun({ ...request, reasoningEffort: "low", systemPrompt: "Review." }),
        strategy.documentNormalizationRun({ ...request, instruction: "Normalize." }),
      ];
      for (const run of runs) {
        expect(run.arguments).toContain("contract-model");
        for (const file of run.files) expect(dirname(file.path)).toBe(request.workingDirectory);
      }
      expect(
        strategy.instructedRun({ ...request, reasoningEffort: "low", systemPrompt: "Review." }),
      ).toEqual(runs[0]);
    });

    it("returns the structured result with normalized usage", () => {
      const output = strategy.parseRun(fixtures.completed({ decision: "typed", tags: ["typed"] }));
      expect(output.result).toEqual({ decision: "typed", tags: ["typed"] });
      expect(output.usage).not.toBeNull();
      expect(output.usage!.totalTokens).toBe(
        output.usage!.inputTokens + output.usage!.outputTokens,
      );
    });

    it("fails closed on unreadable output and on any tool use", () => {
      expect(() => strategy.parseRun("not json")).toThrow(NoCapabilityInvocationFailure);
      expect(() => strategy.parseRun("not json")).toThrow(
        expect.objectContaining({ kind: "run_failed" }),
      );
      expect(() => strategy.parseRun(fixtures.usedTool({ ok: true }))).toThrow(
        expect.objectContaining({ kind: "policy_violation" }),
      );
    });

    it("recognizes only native failure envelopes as provider failures", () => {
      expect(strategy.isNativeFailureEvent(fixtures.nativeFailureEvent)).toBe(true);
      expect(strategy.isNativeFailureEvent(fixtures.successEvent)).toBe(false);
    });
  });
}
