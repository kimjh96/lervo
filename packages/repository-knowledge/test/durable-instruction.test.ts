import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDurableInstructionPlan,
  createDurableInstructionPlan,
  durableInstructionCatalogEntry,
  recoverKnowledgeMaterialization,
  repositoryInstructionRouteBlock,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-durable-instruction-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_durable_instruction",
      now: new Date("2026-08-30T00:00:00.000Z"),
    }),
  );
  return root;
}

const canonicalInstruction = {
  disposition: "canonical" as const,
  speechAct: "directive" as const,
  authority: "explicit_user" as const,
  durability: "repository" as const,
  operation: "add" as const,
  scope: { kind: "repository" as const, paths: [] },
  title: "Conventional commit messages",
  statement: "Use Conventional Commits for every repository commit.",
  exceptions: [],
  risk: "low" as const,
  conflict: "none" as const,
  confidence: "high" as const,
  reasonIds: ["explicit_repository_rule"],
};

describe("semantic durable instruction intake", () => {
  it("materializes one deterministic canonical instruction and replans current", async () => {
    const root = await repository();
    const input = {
      repositoryRoot: root,
      projectId: "prj_durable_instruction",
      requestDigest: `sha256:${"a".repeat(64)}`,
      resolverResultDigest: `sha256:${"b".repeat(64)}`,
      groundingStatus: "ready" as const,
      catalogComplete: true,
      ambiguityReasons: [],
      instruction: canonicalInstruction,
    };
    const plan = await createDurableInstructionPlan(input);
    expect(plan).toMatchObject({ status: "ready", ruleId: expect.stringMatching(/^rule_/u) });
    expect(JSON.stringify(plan)).not.toMatch(/prompt|keyword|phrase/iu);
    await applyDurableInstructionPlan({
      plan,
      receipt: { status: "applied" },
      recordApplied: () => undefined,
    });
    const content = await readFile(resolve(root, plan.targetPath!), "utf8");
    expect(content).toContain("Use Conventional Commits for every repository commit.");
    expect(content).not.toContain("sha256:");
    expect(await createDurableInstructionPlan(input)).toMatchObject({
      status: "current",
      ruleId: plan.ruleId,
      targetPath: plan.targetPath,
    });
  });

  it("keeps noisy or incomplete semantic results out of canonical repository bytes", async () => {
    const root = await repository();
    const plan = await createDurableInstructionPlan({
      repositoryRoot: root,
      projectId: "prj_durable_instruction",
      requestDigest: `sha256:${"c".repeat(64)}`,
      resolverResultDigest: `sha256:${"d".repeat(64)}`,
      groundingStatus: "ready",
      catalogComplete: false,
      ambiguityReasons: [],
      instruction: canonicalInstruction,
    });
    expect(plan).toMatchObject({
      status: "pending",
      reasonIds: expect.arrayContaining(["automatic_gate_not_satisfied"]),
    });
    await expect(access(resolve(root, "docs/instructions/generated"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const example = await createDurableInstructionPlan({
      ...{
        repositoryRoot: root,
        projectId: "prj_durable_instruction",
        requestDigest: `sha256:${"e".repeat(64)}`,
        resolverResultDigest: `sha256:${"f".repeat(64)}`,
        groundingStatus: "ready" as const,
        catalogComplete: true,
        ambiguityReasons: [],
      },
      instruction: {
        ...canonicalInstruction,
        disposition: "pending",
        speechAct: "example",
        authority: "inferred",
        reasonIds: ["example_not_authority"],
      },
    });
    expect(example.status).toBe("pending");
  });

  it("recovers an interrupted durable-instruction transaction without publishing the rule", async () => {
    const root = await repository();
    const plan = await createDurableInstructionPlan({
      repositoryRoot: root,
      projectId: "prj_durable_instruction",
      requestDigest: `sha256:${"1".repeat(64)}`,
      resolverResultDigest: `sha256:${"2".repeat(64)}`,
      groundingStatus: "ready",
      catalogComplete: true,
      ambiguityReasons: [],
      instruction: canonicalInstruction,
    });
    await expect(
      applyDurableInstructionPlan({
        plan,
        receipt: { status: "applied" },
        recordApplied: () => undefined,
        failureInjector: (checkpoint) => (checkpoint === "published:0" ? "interrupt" : undefined),
      }),
    ).rejects.toMatchObject({ code: "knowledge_recovery_required" });
    expect(
      await recoverKnowledgeMaterialization({
        repositoryRoot: root,
        eventRecorded: () => false,
      }),
    ).toMatchObject({ planId: plan.planId, disposition: "rolled_back" });
    await expect(access(resolve(root, plan.targetPath!))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the AGENTS bootstrap constant as registry entries grow", () => {
    const small = repositoryInstructionRouteBlock({ instructions: [], skills: [] });
    const large = repositoryInstructionRouteBlock({
      instructions: Array.from({ length: 500 }, (_, index) => ({
        path: `docs/instructions/rule-${index}.md`,
        instructionPaths: [`packages/p${index}/**`],
      })),
      skills: Array.from({ length: 500 }, (_, index) => ({
        path: `.agents/skills/skill-${index}/SKILL.md`,
      })),
    });
    expect(large).toBe(small);
    expect(Buffer.byteLength(large)).toBeLessThan(4 * 1024);
    expect(large).toContain("schema=2");
  });

  it("bounds multibyte catalog excerpts by UTF-8 bytes", () => {
    const entry = durableInstructionCatalogEntry({
      path: "docs/instructions/korean.md",
      content: "규칙".repeat(1_000),
    });
    expect(Buffer.byteLength(entry.excerpt)).toBeLessThanOrEqual(2_048);
    expect(entry.excerpt).not.toContain("�");
  });
});
