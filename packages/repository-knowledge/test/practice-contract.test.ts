import { describe, expect, it } from "vitest";
import {
  instructionCaptureRequest,
  instructionCaptureRoute,
  parseInstructionCaptureAssessment,
  parseReusablePractice,
  practiceReviewValid,
  renderPracticeSkill,
  sanitizePracticeText,
  sha256,
} from "../src/index.js";

const procedure = {
  name: "bounded-check",
  description: "Verify a changed package with bounded evidence.",
  goal: "Confirm a package change.",
  whenToUse: ["A package implementation changes."],
  whenNotToUse: ["Only prose changes."],
  inputs: ["Changed package paths."],
  preconditions: ["The package has a verification command."],
  steps: ["Run the package verification."],
  confirmation: ["Observe a zero exit status."],
  stopConditions: ["Stop on unavailable verification."],
  verified: ["The recorded command passed."],
  assumptions: [],
  sourcePaths: [],
};
const none = {
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
};

describe("ADR-0543 independent capture fields", () => {
  it("carries work beside an ordinary Korean directive in one request", () => {
    const request = instructionCaptureRequest({
      surface: "terminal_prompt",
      ownerTurn: "계속 구현해",
      precedingAgentTurn: null,
      semanticCatalog: {},
      precedingWork: { outcome: "passed" },
    });
    expect(request.untrustedOwnerTurn).toBe("계속 구현해");
    expect(request.untrustedPrecedingWork).toEqual({ outcome: "passed" });
    const assessment = parseInstructionCaptureAssessment({
      schemaVersion: 1,
      captureClass: "none",
      durableInstruction: none,
      decision: null,
      reasonIds: [],
      practice: procedure,
    });
    expect(instructionCaptureRoute(assessment)).toBe("ignored");
    expect(assessment.practice).toEqual(procedure);
  });

  it.each([null, { bad: true }, { ...procedure, tools: ["shell"] }])(
    "isolates malformed practice from a rule capture: %j",
    (practice) => {
      const assessment = parseInstructionCaptureAssessment({
        schemaVersion: 1,
        captureClass: "durable_instruction",
        durableInstruction: {
          ...none,
          disposition: "canonical",
          title: "Preserve user content.",
          statement: "Never replace user-owned regions.",
        },
        decision: null,
        reasonIds: [],
        practice,
      });
      expect(instructionCaptureRoute(assessment)).toBe("instruction");
      expect(assessment.practice).toBeNull();
    },
  );

  it("renders portable Agent Skills bytes with every procedure field and no capability header", () => {
    const draft = renderPracticeSkill(parseReusablePractice(procedure)!);
    expect(draft).toMatch(/^---\nname: bounded-check\ndescription:/u);
    expect(draft).toContain("## Stop conditions");
    expect(draft).toContain("## Assumptions");
    expect(draft).not.toContain("allowed-tools:");
    expect(() => parseReusablePractice({ ...procedure, sourcePaths: ["../private"] })).toThrow();
    expect(() =>
      renderPracticeSkill({ ...procedure, steps: Array(24).fill("x".repeat(512)) }),
    ).toThrow();
  });

  it("removes complete secret lines and private-key blocks", () => {
    const secret = "sk-" + "x".repeat(24);
    const text = `Useful step.\nAPI_TOKEN=${secret}\n-----BEGIN PRIVATE KEY-----\nsecret material\n-----END PRIVATE KEY-----\nConfirm success.\n/home/someone/host-only`;
    expect(sanitizePracticeText(text)).toBe("Useful step.\n\nConfirm success.");
  });
});

describe("ADR-0543 independent exact review", () => {
  const binding = {
    draftHash: sha256("draft"),
    evidenceHashes: [sha256("work")],
    targetHash: null,
    catalogDigest: sha256("catalog"),
  };
  const review = {
    ...binding,
    reviewerAgentId: "reviewer",
    reviewerSessionId: "review-session",
    decision: "accept" as const,
    reasonCode: "accepted" as const,
  };
  const valid = {
    expected: binding,
    review,
    drafterAgentId: "drafter",
    drafterSessionId: "draft-session",
  };
  it("requires both agent and session independence", () => {
    expect(practiceReviewValid(valid)).toBe(true);
    expect(practiceReviewValid({ ...valid, drafterAgentId: "reviewer" })).toBe(false);
    expect(practiceReviewValid({ ...valid, drafterSessionId: "review-session" })).toBe(false);
  });
  it.each(["draftHash", "evidenceHashes", "targetHash", "catalogDigest"] as const)(
    "rejects a changed %s",
    (field) => {
      const changed = {
        ...review,
        [field]: field === "evidenceHashes" ? [sha256("different")] : sha256("different"),
      };
      expect(practiceReviewValid({ ...valid, review: changed })).toBe(false);
    },
  );
});
