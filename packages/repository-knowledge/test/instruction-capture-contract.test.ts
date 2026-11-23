import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  durableInstructionCatalogDigest,
  instructionCaptureAssessmentInstruction,
  instructionCaptureRequest,
  instructionCaptureRoute,
  listGeneratedDurableInstructions,
  parseInstructionCaptureAssessment,
} from "../src/index.js";
import {
  createDurableInstructionCandidate,
  validateDurableInstructionCandidate,
} from "../src/durable-instruction-candidate.js";
import {
  createDurableInstructionPlan,
  type GroundedDurableInstruction,
} from "../src/durable-instruction.js";

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
const rule = {
  ...none,
  disposition: "canonical",
  speechAct: "directive",
  authority: "explicit_user",
  durability: "repository",
  operation: "add",
  scope: { kind: "repository", paths: [] },
  title: "Keep both hosts available",
  statement: "Resolve host conflicts without restricting work to one host.",
  risk: "low",
  conflict: "none",
  confidence: "high",
};

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("instruction capture assessment contract (ADR-0467)", () => {
  it("routes each semantic class from the typed provider result alone", () => {
    const cases = [
      [{ captureClass: "none", durableInstruction: none, decision: null }, "ignored"],
      [
        { captureClass: "preference_personal", durableInstruction: none, decision: null },
        "personal_preference",
      ],
      [
        { captureClass: "durable_instruction", durableInstruction: rule, decision: null },
        "instruction",
      ],
      [
        { captureClass: "correction_of_agent_behavior", durableInstruction: rule, decision: null },
        "instruction",
      ],
      [
        {
          captureClass: "decision",
          durableInstruction: none,
          decision: {
            title: "Use one writer",
            statement: "One host writes.",
            subjectKey: "writer",
          },
        },
        "decision",
      ],
      [
        {
          captureClass: "decision",
          durableInstruction: rule,
          decision: { title: "Keep hosts", statement: "Both hosts stay.", subjectKey: "hosts" },
        },
        "instruction",
      ],
    ] as const;
    for (const [body, route] of cases)
      expect(
        instructionCaptureRoute(
          parseInstructionCaptureAssessment({ schemaVersion: 1, reasonIds: [], ...body }),
        ),
      ).toBe(route);
  });

  it("rejects malformed or inconsistent assessments instead of guessing", () => {
    const valid = {
      schemaVersion: 1,
      captureClass: "none",
      durableInstruction: none,
      decision: null,
      reasonIds: [],
    };
    expect(() => parseInstructionCaptureAssessment({ ...valid, extra: true })).toThrow(TypeError);
    expect(() => parseInstructionCaptureAssessment({ ...valid, captureClass: "maybe" })).toThrow(
      TypeError,
    );
    expect(() => parseInstructionCaptureAssessment({ ...valid, captureClass: "decision" })).toThrow(
      TypeError,
    );
    expect(() =>
      parseInstructionCaptureAssessment({
        ...valid,
        durableInstruction: { ...none, scope: { kind: "repository" } },
      }),
    ).toThrow(TypeError);
    expect(() =>
      parseInstructionCaptureAssessment({ ...valid, reasonIds: ["Not An Identifier"] }),
    ).toThrow(TypeError);
  });

  it("reads plan items on their own, so a missing or malformed list never fails rule capture (ADR-0563)", () => {
    const valid = {
      schemaVersion: 1,
      captureClass: "none",
      durableInstruction: none,
      decision: null,
      reasonIds: [],
      practice: null,
    };
    expect(parseInstructionCaptureAssessment(valid).planItems).toEqual([]);
    const parent = "p1";
    expect(
      parseInstructionCaptureAssessment({
        ...valid,
        planItems: [
          {
            kind: "directive",
            title: "Fix  the idle Node health",
            confidence: "high",
            parent,
          },
          {
            kind: "finding",
            title: "pnpm is missing on the follower PATH",
            confidence: "low",
            parent: null,
          },
        ],
      }).planItems,
    ).toEqual([
      {
        kind: "directive",
        title: "Fix the idle Node health",
        confidence: "high",
        parent,
      },
      {
        kind: "finding",
        title: "pnpm is missing on the follower PATH",
        confidence: "low",
        parent: null,
      },
    ]);
    // A malformed item is dropped alone; only a value that is not a list is a failure.
    expect(
      parseInstructionCaptureAssessment({
        ...valid,
        planItems: [
          { kind: "chore", title: "x", confidence: "high", parent: null },
          { kind: "plan", title: "x".repeat(241), confidence: "high", parent: null },
          { kind: "plan", title: "Keep this", confidence: "high", parent: "p33" },
          { kind: "plan", title: "Keep this", confidence: "low", parent: "p2" },
        ],
      }).planItems,
    ).toEqual([{ kind: "plan", title: "Keep this", confidence: "low", parent: "p2" }]);
    expect(parseInstructionCaptureAssessment({ ...valid, planItems: "everything" })).toMatchObject({
      captureClass: "none",
      planItems: [],
      planItemsFailure: "invalid",
    });
    const request = instructionCaptureRequest({
      surface: "terminal_prompt",
      ownerTurn: "고쳐",
      precedingAgentTurn: "Two follow-ups remain.",
      semanticCatalog: { schemaVersion: 1 },
      openPlanItems: Array.from({ length: 40 }, (_, index) => ({
        itemId: `pli_${String(index).padStart(24, "0")}`,
        kind: "plan",
        title: `Item ${index}`,
      })),
    });
    expect(request.openPlanItems).toHaveLength(32);
    // The provider sees references, never ledger ids.
    expect(request.openPlanItems[0]).toEqual({ reference: "p1", kind: "plan", title: "Item 0" });
    expect(JSON.stringify(request.openPlanItems)).not.toContain("pli_");
    expect(instructionCaptureAssessmentInstruction).toContain("planItems");
  });

  it("reads plan closes on their own and never closes done without named evidence (ADR-0563)", () => {
    const valid = {
      schemaVersion: 1,
      captureClass: "none",
      durableInstruction: none,
      decision: null,
      reasonIds: [],
      practice: null,
      planItems: [],
    };
    expect(parseInstructionCaptureAssessment(valid).closedPlanItems).toEqual([]);
    const close = (fields: Record<string, unknown>) => ({
      reference: "p1",
      state: "done",
      pullRequest: null,
      release: null,
      supersededBy: null,
      ...fields,
    });
    expect(
      parseInstructionCaptureAssessment({
        ...valid,
        closedPlanItems: [
          close({ pullRequest: 351 }),
          close({ reference: "p2", release: "v0.43.1" }),
          close({ reference: "p3" }),
          close({ reference: "p4", pullRequest: 0 }),
          close({ reference: "p5", release: "../v1" }),
          close({ reference: "p6", state: "superseded", supersededBy: "p2" }),
          close({ reference: "p7", state: "superseded", supersededBy: "p7" }),
          close({ reference: "p33", pullRequest: 1 }),
          close({ pullRequest: 352 }),
          { ...close({ reference: "p8", pullRequest: 1 }), commit: "abc" },
          close({ reference: "p9", pullRequest: 2, release: "v1.0.0" }),
        ],
      }).closedPlanItems,
    ).toEqual([
      { reference: "p1", state: "done", pullRequest: 351, release: null, supersededBy: null },
      { reference: "p2", state: "done", pullRequest: null, release: "v0.43.1", supersededBy: null },
      {
        reference: "p6",
        state: "superseded",
        pullRequest: null,
        release: null,
        supersededBy: "p2",
      },
    ]);
    expect(
      parseInstructionCaptureAssessment({ ...valid, closedPlanItems: { all: true } }),
    ).toMatchObject({
      captureClass: "none",
      closedPlanItems: [],
      closedPlanItemsFailure: "invalid",
    });
    expect(instructionCaptureAssessmentInstruction).toContain("closedPlanItems");
  });

  it("passes turn text only as untrusted provider input and forbids lexical classification", () => {
    const request = instructionCaptureRequest({
      surface: "conversation",
      ownerTurn: "그건 아니야, 다시는 그렇게 하지 마.",
      precedingAgentTurn: "I disabled the WSL worker.",
      semanticCatalog: { schemaVersion: 1 },
    });
    expect(request).toMatchObject({
      task: "instruction_capture_assessment",
      untrustedOwnerTurn: "그건 아니야, 다시는 그렇게 하지 마.",
      untrustedPrecedingAgentTurn: "I disabled the WSL worker.",
    });
    expect(instructionCaptureAssessmentInstruction).toContain(
      "Never decide by keyword, phrase, substring, regular expression, alias, or synonym list",
    );
  });

  it("binds review to the instruction catalog digest, independent of entry order", () => {
    const entries = [
      { path: "docs/instructions/b.md", contentHash: `sha256:${"b".repeat(64)}` },
      { path: "AGENTS.md", contentHash: `sha256:${"a".repeat(64)}` },
    ];
    expect(durableInstructionCatalogDigest(entries)).toBe(
      durableInstructionCatalogDigest([...entries].reverse()),
    );
  });

  it("lists applied generated rules by title and skips malformed files", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-generated-rules-"));
    roots.push(root);
    expect(await listGeneratedDurableInstructions(root)).toEqual({ rules: [], totalCount: 0 });
    const directory = resolve(root, "docs/instructions/generated");
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, `rule_${"a".repeat(24)}.md`),
      "---\nlervo:\n  durableInstruction:\n    schemaVersion: 1\n---\n# Keep both hosts available\n\nBody.\n",
    );
    await writeFile(resolve(directory, `rule_${"b".repeat(24)}.md`), "no heading\n");
    await writeFile(resolve(directory, "notes.md"), "# Not a rule\n");
    expect(await listGeneratedDurableInstructions(root)).toEqual({
      rules: [
        {
          ruleId: `rule_${"a".repeat(24)}`,
          path: `docs/instructions/generated/rule_${"a".repeat(24)}.md`,
          title: "Keep both hosts available",
        },
      ],
      totalCount: 2,
    });
  });

  it("accepts captured candidate provenance and rejects an explicit intake with a capture ID", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-captured-candidate-"));
    roots.push(root);
    const plan = await createDurableInstructionPlan({
      repositoryRoot: root,
      projectId: "prj_capturefixture",
      requestDigest: `sha256:${"1".repeat(64)}`,
      resolverResultDigest: `sha256:${"2".repeat(64)}`,
      instruction: rule as GroundedDurableInstruction,
    });
    const captured = createDurableInstructionCandidate({
      plan,
      provider: "claude",
      sourceSnapshotId: `ksnap_${"3".repeat(24)}`,
      instruction: rule as GroundedDurableInstruction,
      now: new Date("2026-10-05T00:00:00.000Z"),
      instructionCatalogDigest: `sha256:${"4".repeat(64)}`,
      capture: { source: "conversation", captureId: `kcap_${"5".repeat(24)}` },
    });
    expect(validateDurableInstructionCandidate(captured)).toMatchObject({
      captureSource: "conversation",
      captureId: `kcap_${"5".repeat(24)}`,
    });
    const {
      instructionCatalogDigest: _digest,
      captureSource: _source,
      captureId: _id,
      ...legacy
    } = captured;
    expect(validateDurableInstructionCandidate(legacy)).toEqual(legacy);
    expect(() =>
      validateDurableInstructionCandidate({ ...captured, captureSource: "explicit_intake" }),
    ).toThrow("The durable-instruction candidate record is invalid.");
    expect(() => validateDurableInstructionCandidate({ ...captured, unexpected: true })).toThrow(
      "The durable-instruction candidate record is invalid.",
    );
  });
});

describe("practice field isolation (ADR-0543)", () => {
  const response = {
    schemaVersion: 1,
    captureClass: "none",
    durableInstruction: none,
    decision: null,
    reasonIds: [],
  };
  it("keeps rule capture valid whether practice is null, missing, or malformed", () => {
    expect(parseInstructionCaptureAssessment({ ...response, practice: null }).practice).toBeNull();
    expect(parseInstructionCaptureAssessment(response).practice).toBeNull();
    expect(parseInstructionCaptureAssessment({ ...response, practice: { x: 1 } })).toMatchObject({
      practice: null,
      practiceFailure: "source_incomplete",
    });
    expect(() =>
      parseInstructionCaptureAssessment({ ...response, practice: null, unexpected: 1 }),
    ).toThrow(TypeError);
  });
});
