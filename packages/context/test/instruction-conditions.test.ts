import { describe, expect, it } from "vitest";
import {
  readInstructionConditions,
  resolveInstructionConditions,
} from "../src/instruction-conditions.js";
import { resolveInstructionPrecedence } from "../src/instruction-precedence.js";
import type { InstructionSource } from "../src/instruction-sources.js";
const read = (yaml: string) =>
  readInstructionConditions(
    `---\nlervo:\n  contextScope:\n    schemaVersion: 1\n${yaml}\n---\nKeep the complete clause.`,
  );
const ruleA = `rule_${"a".repeat(24)}`;
const ruleB = `rule_${"b".repeat(24)}`;
const rule = (id: string, yaml: string): InstructionSource => ({
  path: `docs/instructions/generated/${id}.md`,
  content: "rule",
  contentHash: `sha256:${"a".repeat(64)}`,
  paths: [],
  applicability: "applicable",
  conditions: read(yaml)!,
});
describe("structured instruction conditions", () => {
  it("conjoins explicit actions, artifact kinds and paths; unknown coordinates remain unresolved", () => {
    const condition = read(
      '    when:\n      paths: ["docs/**"]\n      artifactKinds: [markdown]\n      requestedActions: [publish]',
    );
    expect(
      resolveInstructionConditions("applicable", condition, ["docs/a.md"], {
        artifactKinds: ["markdown"],
        requestedActions: ["publish"],
      }),
    ).toBe("applicable");
    expect(resolveInstructionConditions("applicable", condition, ["docs/a.md"], {})).toBe(
      "unresolved",
    );
    expect(resolveInstructionConditions("applicable", condition, ["src/a.ts"], {})).toBe(
      "not_applicable",
    );
  });
  it("applies explicit exceptions without inferring permission from request text", () => {
    const condition = read("    except:\n      - artifactKinds: [quotation]");
    expect(
      resolveInstructionConditions("applicable", condition, [], { artifactKinds: ["quotation"] }),
    ).toBe("not_applicable");
    expect(resolveInstructionConditions("applicable", condition, [], {})).toBe("unresolved");
    expect(
      resolveInstructionConditions("applicable", condition, [], { artifactKinds: ["markdown"] }),
    ).toBe("applicable");
  });
  it("binds a one-task exception to the exact digest and detects changed targets", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const condition = read(`    when:\n      taskDigests: ["${digest}"]`);
    expect(resolveInstructionConditions("applicable", condition, [], { taskDigest: digest })).toBe(
      "applicable",
    );
    expect(
      resolveInstructionConditions("applicable", condition, [], {
        taskDigest: `sha256:${"b".repeat(64)}`,
      }),
    ).toBe("not_applicable");
  });
  it.each([
    "    when: {unknown: [x]}",
    "    except: [{}]",
    "    schemaVersion: 2",
    "    when: {paths: [../secret]}",
  ])("rejects malformed descriptors without echoing their content", (yaml) => {
    expect(() => read(yaml)).toThrow("Instruction scope metadata is invalid.");
  });
  it("preserves equal-authority conflicts and only honors explicit acyclic replacements", () => {
    const a = rule(ruleA, "    decision: {key: language, value: en}");
    const b = rule(ruleB, "    decision: {key: language, value: ko}");
    expect(resolveInstructionPrecedence([a, b]).map((source) => source.applicability)).toEqual([
      "conflict",
      "conflict",
    ]);
    b.conditions!.supersedes = [ruleA];
    expect(resolveInstructionPrecedence([a, b]).map((source) => source.applicability)).toEqual([
      "not_applicable",
      "applicable",
    ]);
    a.conditions!.supersedes = [ruleB];
    expect(resolveInstructionPrecedence([a, b]).map((source) => source.applicability)).toEqual([
      "conflict",
      "conflict",
    ]);
  });
  it("does not suppress a rule through an inapplicable or missing replacement", () => {
    const a = rule(ruleA, "    decision: {key: language, value: en}");
    const b = rule(ruleB, `    supersedes: [${ruleA}]`);
    b.applicability = "not_applicable";
    expect(resolveInstructionPrecedence([a, b])[0]!.applicability).toBe("applicable");
    a.conditions!.supersedes = ["missing"];
    expect(resolveInstructionPrecedence([a])[0]!.applicability).toBe("unresolved");
  });
});
