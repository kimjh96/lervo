import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyKnowledgeInstructionBootstrapPlan,
  applyKnowledgeInstructionBridgePlan,
  createKnowledgeInstructionBootstrapPlan,
  createKnowledgeInstructionBridgePlan,
} from "../src/index.js";

const roots: string[] = [];

async function claudeOnlyRepository(content: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-instruction-bootstrap-"));
  roots.push(root);
  await writeFile(resolve(root, "CLAUDE.md"), content);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_instruction_bootstrap",
      now: new Date("2026-08-25T00:00:00.000Z"),
    }),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("canonical instruction bootstrap", () => {
  it("adopts exact Claude-only instructions before creating a thin provider bridge", async () => {
    const original = "# Flemo instructions\n\nPreserve the release boundary.\n";
    const root = await claudeOnlyRepository(original);
    const adoption = await createKnowledgeInstructionBootstrapPlan({ repositoryRoot: root });
    expect(adoption).toMatchObject({
      planKind: "instruction_canonical_bootstrap",
      status: "review_required",
      source: { state: "shared_candidate" },
      canonical: { state: "missing" },
    });

    await applyKnowledgeInstructionBootstrapPlan({
      plan: adoption,
      approvedOperationId: adoption.operationId!,
      approvedHash: adoption.approvalHash!,
      now: new Date("2026-08-25T00:01:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(await readFile(resolve(root, "CLAUDE.md"), "utf8")).toBe(original);
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toMatch(
      /^# Flemo instructions\n\nPreserve the release boundary\.\n\n<!-- lervo:begin block=repository_instruction_routes/u,
    );

    const bridge = await createKnowledgeInstructionBridgePlan({
      repositoryRoot: root,
      provider: "claude",
    });
    expect(bridge.target).toMatchObject({
      action: "update",
      classification: "exact_adopted_duplicate",
    });
    await applyKnowledgeInstructionBridgePlan({
      plan: bridge,
      approvedOperationId: bridge.operationId,
      approvedHash: bridge.approvalHash,
      now: new Date("2026-08-25T00:02:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(await readFile(resolve(root, "CLAUDE.md"), "utf8")).toBe(
      "<!-- lervo:begin block=provider_entry schema=1 -->\n@AGENTS.md\n<!-- lervo:end block=provider_entry -->\n",
    );
  });

  it("fails stale adoption closed and rolls back when evidence recording fails", async () => {
    const root = await claudeOnlyRepository("# Instructions\n\nOriginal.\n");
    const stale = await createKnowledgeInstructionBootstrapPlan({ repositoryRoot: root });
    await writeFile(resolve(root, "CLAUDE.md"), "# Instructions\n\nChanged.\n");
    await expect(
      applyKnowledgeInstructionBootstrapPlan({
        plan: stale,
        approvedOperationId: stale.operationId!,
        approvedHash: stale.approvalHash!,
        now: new Date("2026-08-25T00:01:00.000Z"),
        recordApplied: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "knowledge_plan_stale" });
    await expect(access(resolve(root, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });

    const current = await createKnowledgeInstructionBootstrapPlan({ repositoryRoot: root });
    await expect(
      applyKnowledgeInstructionBootstrapPlan({
        plan: current,
        approvedOperationId: current.operationId!,
        approvedHash: current.approvalHash!,
        now: new Date("2026-08-25T00:02:00.000Z"),
        recordApplied: () => {
          throw new Error("event store unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "knowledge_apply_failed" });
    await expect(access(resolve(root, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("defers a Claude source that already mixes provider imports or managed blocks", async () => {
    const root = await claudeOnlyRepository("# Claude instructions\n\n@AGENTS.md\n");
    const plan = await createKnowledgeInstructionBootstrapPlan({ repositoryRoot: root });
    expect(plan).toMatchObject({
      status: "blocked",
      disposition: "defer",
      source: { state: "unresolved_mixed" },
      blocker: "claude_source_contains_provider_import_or_managed_blocks",
    });
    await expect(access(resolve(root, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
