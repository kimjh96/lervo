import { describe, expect, it } from "vitest";
import { selectWorkforceAllocation, type WorkforceAllocationCandidate } from "../src/index.js";
import { hash } from "./operating-supervision.fixture.js";
const candidate = (letter: string, isOwner = false): WorkforceAllocationCandidate => ({
  agentId: `agt_${letter.repeat(24)}`,
  isOwner,
  status: "available",
  sourceHash: hash(),
  reasonCodes: [],
});
const select = (
  candidates: WorkforceAllocationCandidate[],
  environment: "ready" | "failed" | "unobserved" = "ready",
) => selectWorkforceAllocation({ sourceHash: hash(), candidates, environment });
describe("observed workforce allocation", () => {
  it("prefers suitable staff over the owner and records hiring as not selected", () => {
    const result = select([candidate("a", true), candidate("b")]);
    expect(result).toMatchObject({
      disposition: "reuse_existing",
      agentId: candidate("b").agentId,
    });
    expect(result.alternatives.find((item) => item.kind === "hire_worker")!.disposition).toBe(
      "not_selected",
    );
  });
  it("uses the owner without imposing minimum headcount", () =>
    expect(select([candidate("a", true)]).disposition).toBe("execute_as_owner"));
  it("distinguishes capacity from skill gaps without authorizing hiring or lease release", () => {
    expect(select([{ ...candidate("b"), status: "busy" }]).disposition).toBe("capacity_gap");
    const result = select([{ ...candidate("b"), status: "incompatible" }]);
    expect(result.disposition).toBe("skill_gap");
    expect(result.alternatives.find((item) => item.kind === "hire_worker")!.disposition).toBe(
      "mandate_and_capacity_review_required",
    );
  });
  it.each(["failed", "unobserved"] as const)(
    "does not hire around %s environment",
    (environment) => {
      expect(select([], environment)).toMatchObject({
        disposition: "blocked",
        reasonCode: `environment_${environment}`,
      });
    },
  );
  it("does not interpret missing staff observations as absence", () =>
    expect(select([{ ...candidate("b"), status: "unobserved" }]).disposition).toBe("blocked"));
  it("rejects duplicate agents and detaches rationale from caller mutation", () => {
    expect(() => select([candidate("a"), candidate("a")])).toThrow();
    const candidates = [candidate("b")];
    const result = select(candidates);
    candidates[0]!.status = "busy";
    expect(result.candidates[0]!.status).toBe("available");
  });
});
