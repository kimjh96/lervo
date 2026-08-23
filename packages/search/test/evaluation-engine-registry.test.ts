import { describe, expect, it } from "vitest";

import {
  SearchEvaluationEngineRegistry,
  SEARCH_ENGINE,
  contentId,
  type SearchEvaluationEnginePort,
} from "../src/index.js";

function engine(id: string, version: number): SearchEvaluationEnginePort {
  return {
    engine: { id, version },
    adapterBuildId: contentId("sebuild", { id, version }),
    buildIndex() {
      throw new Error("This registry test does not build an index.");
    },
  };
}

describe("search evaluation engine registry", () => {
  it("resolves only explicit allowlist registrations in stable order", () => {
    const alpha = engine("alpha", 1);
    const beta = engine("beta", 2);
    const registry = new SearchEvaluationEngineRegistry([
      { candidateId: "beta-v2", engine: beta },
      { candidateId: "alpha-v1", engine: alpha },
    ]);

    expect(registry.list()).toEqual([
      { candidateId: "alpha-v1", engine: { id: "alpha", version: 1 }, adapterBuildId: alpha.adapterBuildId },
      { candidateId: "beta-v2", engine: { id: "beta", version: 2 }, adapterBuildId: beta.adapterBuildId },
    ]);
    expect(registry.resolve("beta-v2")).toBe(beta);
    expect(registry.resolveEngine({ id: "alpha", version: 1 })).toEqual({ candidateId: "alpha-v1", engine: alpha });
    expect(() => registry.resolve("module:/tmp/candidate.js")).toThrow(/not registered/);
  });

  it("rejects duplicate candidate and engine coordinates", () => {
    expect(() => new SearchEvaluationEngineRegistry([
      { candidateId: "same-v1", engine: engine("alpha", 1) },
      { candidateId: "same-v1", engine: engine("beta", 1) },
    ])).toThrow(/duplicated/);
    expect(() => new SearchEvaluationEngineRegistry([
      { candidateId: "alpha-one", engine: engine("alpha", 1) },
      { candidateId: "alpha-again", engine: engine("alpha", 1) },
    ])).toThrow(/duplicated/);
    const alpha = engine("alpha", 1);
    expect(() => new SearchEvaluationEngineRegistry([
      { candidateId: "alpha-one", engine: alpha },
      {
        candidateId: "beta-one",
        engine: { ...engine("beta", 1), adapterBuildId: alpha.adapterBuildId },
      },
    ])).toThrow(/duplicated/);
  });

  it("does not register the production baseline as a candidate", () => {
    expect(() => new SearchEvaluationEngineRegistry([
      { candidateId: "baseline", engine: engine(SEARCH_ENGINE.id, SEARCH_ENGINE.version) },
    ])).toThrow(/invalid/);
  });
});
