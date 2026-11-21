import { describe, expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";

import {
  practiceDraftContract,
  practiceReviewContract,
  practiceUsageReviewContract,
} from "../src/practice-review-contract.js";
import { practice } from "./practice-fixture.js";

const invalid = expect.objectContaining({ code: "knowledge_semantic_review_invalid" });
const skill = (name: string) => ({
  name,
  path: `.agents/skills/${name}/SKILL.md`,
  contentHash: sha256(name),
  content: `# ${name}\n`,
  owned: true,
});
const catalog = {
  skills: [skill("bounded-check"), skill("release-notes")],
  rules: [{ path: "AGENTS.md", contentHash: sha256("rules"), excerpt: "Run checks." }],
};
const grounded = { ...practice, sourcePaths: ["src/visible.ts"] };

describe("practice draft contract (ADR-0604)", () => {
  const contract = practiceDraftContract({ catalog, evidencePaths: ["src/visible.ts"] });
  const answer = (overrides: Record<string, unknown>) => ({
    overlap: "partial_overlap",
    target: "t1",
    targetPath: catalog.skills[0]!.path,
    practice: grounded,
    ...overrides,
  });

  it("shows targets by reference and path, never a hash, and maps one back to its skill", () => {
    expect(JSON.stringify(contract.view)).not.toContain("sha256:");
    expect(contract.view.skills.map((item) => item.target)).toEqual(["t1", "t2"]);
    expect(contract.schema.properties.target).toEqual({
      type: ["string", "null"],
      enum: ["t1", "t2", null],
    });
    expect(contract.parse(answer({})).target).toBe(catalog.skills[0]);
    expect(
      contract.parse(answer({ overlap: "new", target: null, targetPath: null })).target,
    ).toBeNull();
    expect(
      contract.parse(
        answer({
          overlap: "conflict",
          target: "t2",
          targetPath: catalog.skills[1]!.path,
          practice: null,
        }),
      ).target,
    ).toBe(catalog.skills[1]);
  });

  it("rejects a mispaired, garbled or misplaced target and a malformed or ungrounded draft", () => {
    for (const value of [
      // A valid reference paired with another skill's path names no single skill.
      answer({ targetPath: catalog.skills[1]!.path }),
      answer({ target: "t3" }),
      answer({ target: sha256("bounded-check") }),
      answer({ target: null, targetPath: null }),
      answer({ overlap: "new" }),
      answer({ overlap: "already_covered", practice: grounded }),
      answer({ overlap: "conflict", practice: grounded }),
      answer({ overlap: "maybe" }),
      answer({ practice: { ...grounded, name: "another-name" } }),
      answer({ practice: { ...grounded, sourcePaths: ["excluded/hidden.ts"] } }),
      answer({ practice: { ...grounded, steps: [] } }),
      answer({ practice: null }),
      { ...answer({}), targetHash: sha256("bounded-check") },
      null,
    ])
      expect(() => contract.parse(value)).toThrow(invalid);
  });

  it("allows only a null target when the catalog has no skill", () => {
    const empty = practiceDraftContract({ catalog: { skills: [], rules: [] }, evidencePaths: [] });
    expect(empty.schema.properties.target).toEqual({ type: "null" });
    expect(empty.schema.properties.targetPath).toEqual({ type: "null" });
  });
});

describe("practice review contracts (ADR-0604)", () => {
  const binding = {
    draftHash: sha256("draft"),
    evidenceHashes: [sha256("work")],
    targetHash: null,
    catalogDigest: sha256("catalog"),
  };
  const reviewer = { agentId: "reviewer", sessionId: "review-session" };

  it("asks for a verdict only and attaches Lervo's exact binding at parse", () => {
    const contract = practiceReviewContract(binding);
    expect(Object.keys(contract.schema.properties)).toEqual(["decision", "reasonCode"]);
    expect(contract.parse({ decision: "reject", reasonCode: "duplicate" }, reviewer)).toEqual({
      ...binding,
      reviewerAgentId: "reviewer",
      reviewerSessionId: "review-session",
      decision: "reject",
      reasonCode: "duplicate",
    });
    for (const value of [
      { decision: "accept", reasonCode: "duplicate" },
      { decision: "reject", reasonCode: "accepted" },
      { decision: "defer", reasonCode: "accepted" },
      // An answer that still echoes a binding breaks the contract.
      { ...binding, decision: "accept", reasonCode: "accepted" },
      {},
    ])
      expect(() => contract.parse(value, reviewer)).toThrow(invalid);
  });

  it("reads a usage verdict as keep or retire and nothing else", () => {
    const contract = practiceUsageReviewContract();
    expect(Object.keys(contract.schema.properties)).toEqual(["decision"]);
    expect(contract.parse({ decision: "retire" })).toBe("retire");
    for (const value of [
      { decision: "delete" },
      { decision: "keep", draftHash: binding.draftHash },
      null,
    ])
      expect(() => contract.parse(value)).toThrow(invalid);
  });
});
