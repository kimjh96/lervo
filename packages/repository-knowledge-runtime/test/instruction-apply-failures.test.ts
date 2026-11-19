import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  INSTRUCTION_APPLY_FAILURES_PATH,
  instructionApplyFailureCode,
  nextInstructionApplyFailure,
  readInstructionApplyFailures,
  writeInstructionApplyFailures,
} from "../src/instruction-apply-failures.js";
import {
  normalizationMayRewrite,
  practiceMaterializationCommit,
} from "../src/normalization-protected-paths.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const candidate = `kinstruction_${"a".repeat(24)}`;

it("records the last apply failure per candidate and drops it once applied", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-instruction-failures-"));
  roots.push(root);
  expect(await readInstructionApplyFailures(root)).toEqual(new Map());
  const first = nextInstructionApplyFailure(
    undefined,
    instructionApplyFailureCode(
      Object.assign(new Error("x"), { code: "knowledge_output_commit_pending" }),
    ),
    "2026-11-19T10:00:00.000Z",
  );
  const second = nextInstructionApplyFailure(
    first,
    "knowledge_output_commit_pending",
    "2026-11-19T10:05:00.000Z",
  );
  expect(second).toEqual({
    code: "knowledge_output_commit_pending",
    firstFailedAt: "2026-11-19T10:00:00.000Z",
    lastFailedAt: "2026-11-19T10:05:00.000Z",
    attempts: 2,
  });
  await writeInstructionApplyFailures(root, new Map([[candidate, second]]));
  expect((await stat(resolve(root, INSTRUCTION_APPLY_FAILURES_PATH))).mode & 0o777).toBe(0o600);
  expect(await readInstructionApplyFailures(root)).toEqual(new Map([[candidate, second]]));
  await writeInstructionApplyFailures(root, new Map());
  await expect(readFile(resolve(root, INSTRUCTION_APPLY_FAILURES_PATH))).rejects.toThrow();
  expect(instructionApplyFailureCode(new Error("no code"))).toBe("instruction_apply_failed");
  expect(instructionApplyFailureCode({ code: "Not A Code/../" })).toBe("instruction_apply_failed");
});

it("keeps skill files out of normalization and admits them only from practice", () => {
  for (const path of [
    ".agents/skills/deploy/SKILL.md",
    ".claude/skills/deploy",
    ".codex/skills/x/SKILL.md",
  ])
    expect(normalizationMayRewrite(path)).toBe(false);
  for (const path of ["docs/a.md", "README.md", "AGENTS.md", ".agents/skills-index.md"])
    expect(normalizationMayRewrite(path)).toBe(true);
  expect(practiceMaterializationCommit({ body: "x\n\nLervo-Practice-Candidate: kprac_1" })).toBe(
    true,
  );
  expect(practiceMaterializationCommit({ body: "Lervo convergence kco_1 settled." })).toBe(false);
});
