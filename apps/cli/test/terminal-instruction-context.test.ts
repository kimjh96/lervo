import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";

import { prepareTerminalInstructionPreamble } from "../src/terminal-instruction-context.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function repositoryWithRules(rules: Record<string, string>) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-terminal-instructions-"));
  roots.push(root);
  await writeFile(resolve(root, "README.md"), "# Fixture\n");
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_terminalrules" }));
  await mkdir(resolve(root, "docs/instructions/generated"), { recursive: true });
  for (const [id, body] of Object.entries(rules))
    await writeFile(resolve(root, `docs/instructions/generated/rule_${id.repeat(24)}.md`), body);
  return root;
}

const rules = {
  a: `# Keep hosts aligned\n\n${"Coordinate every host instead of restricting one. ".repeat(6)}\n`,
  b: `# Maintain knowledge automatically\n\n${"New projects receive maintenance on every host. ".repeat(6)}\n`,
  c: "# Use Korean for owner-facing responses.\n\nRespond to the owner in Korean.\n",
};

it("names owner rules whose bodies do not fit beside a crowded preamble", async () => {
  const root = await repositoryWithRules(rules);
  // A synchronous turn-declaration contract leaves little room in the 4 KiB compact envelope.
  const prepared = await prepareTerminalInstructionPreamble({
    root,
    preamble: `Lervo compact terminal context.\n${"Declare the turn last. ".repeat(140)}`,
    maximumBytes: 4096,
    prompt: "한국어로 답변해",
    sourceSnapshotId: "ksnap_fixture",
  });
  expect(prepared.report.status).toBe("incomplete");
  expect(prepared.report.omittedCount).toBeGreaterThan(0);
  expect(prepared.preamble).toContain("Owner rules omitted for space still apply");
  for (const title of [
    "Keep hosts aligned",
    "Maintain knowledge automatically",
    "Use Korean for owner-facing responses",
  ])
    expect(prepared.preamble).toContain(title);
  expect(Buffer.byteLength(prepared.preamble)).toBeLessThanOrEqual(4096);
});

it("adds no omission line when every owner rule body fits", async () => {
  const root = await repositoryWithRules(rules);
  const prepared = await prepareTerminalInstructionPreamble({
    root,
    preamble: "Lervo compact terminal context.",
    maximumBytes: 4096,
    prompt: "status",
    sourceSnapshotId: "ksnap_fixture",
  });
  expect(prepared.report).toMatchObject({ status: "complete", preparedCount: 3, omittedCount: 0 });
  expect(prepared.preamble).not.toContain("Owner rules omitted for space");
  expect(prepared.preamble).toContain("Respond to the owner in Korean.");
});

it("prepares owner rules for a prompt with no text without recording a contract failure (ADR-0635)", async () => {
  const root = await repositoryWithRules(rules);
  for (const prompt of ["", "  \n"]) {
    const prepared = await prepareTerminalInstructionPreamble({
      root,
      preamble: "Lervo compact terminal context.",
      maximumBytes: 4096,
      prompt,
      sourceSnapshotId: "ksnap_fixture",
    });
    expect(JSON.stringify(prepared.quality)).not.toContain("context_contract_invalid");
    expect(prepared.preamble).toContain("Respond to the owner in Korean.");
  }
});
