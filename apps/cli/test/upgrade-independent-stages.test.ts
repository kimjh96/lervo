import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import {
  applyTerminalIntegrationStage,
  planTerminalIntegrationStage,
} from "../src/terminal-integration-stage.js";
import { inspectTerminalRepositoryKnowledge } from "../src/terminal-knowledge-lifecycle-inspection.js";
import { loadTerminalHookRuntime } from "../src/terminal-runtime.js";

const roots: string[] = [];
const runtimePath = ".lervo/generated/terminal-hooks/runtime-v2.mjs";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function io(root: string, stdout: string[], stderr: string[]) {
  return {
    cwd: root,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

async function repositoryWithInstalledTerminalHooks(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-independent-"));
  roots.push(root);
  await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
  expect(await runCli(["init", "--minimal", "--name", "argo-fixture"], io(root, [], []))).toBe(0);
  const install = await planTerminalIntegrationStage(root);
  expect(install.plan.status).toBe("review_required");
  await applyTerminalIntegrationStage({
    repositoryRoot: root,
    prepared: install,
    approval: {
      operationId: install.plan.operationId,
      approvalHash: install.plan.approvalHash!,
    },
    now: new Date("2026-09-30T00:00:00Z"),
  });
  return root;
}

describe("lervo upgrade with a blocked stage", () => {
  it("regenerates the terminal runtime while knowledge stays blocked by invalid document metadata", async () => {
    const root = await repositoryWithInstalledTerminalHooks();
    await writeFile(resolve(root, runtimePath), "#!/usr/bin/env node\n// stale runtime\n");
    await mkdir(resolve(root, "v3"), { recursive: true });
    await mkdir(resolve(root, "v4"), { recursive: true });
    const invalidMetadata = ["---", "lervo:", "  document: invalid", "---"].join("\n");
    await writeFile(
      resolve(root, "v3/REQUIREMENTS.md"),
      `${invalidMetadata}\n# Requirements\n\nVersion three.\n`,
    );
    await writeFile(
      resolve(root, "v4/DESIGN.md"),
      `${invalidMetadata}\n# Design\n\nVersion four.\n`,
    );
    const requirements = await readFile(resolve(root, "v3/REQUIREMENTS.md"), "utf8");

    const output: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["upgrade", "--json"], io(root, output, errors))).toBe(1);
    expect(errors).toEqual([]);
    const plan = JSON.parse(output.splice(0).join("")) as {
      planId: string;
      status: string;
      applicableStages: string[];
      policy: { stageDependencies: Record<string, unknown> };
      stages: {
        terminalIntegration: { disposition: string; reason: string };
        knowledge: { disposition: string; blockers: Array<{ code: string; path?: string }> };
      };
    };
    expect(plan.status).toBe("blocked");
    expect(plan.applicableStages).toEqual(["terminal_integration"]);
    expect(plan.policy.stageDependencies.terminal_integration).toEqual([]);
    expect(plan.stages.terminalIntegration).toMatchObject({
      disposition: "safe_apply",
      reason: "generated_runtime_only",
    });
    expect(plan.stages.knowledge.disposition).toBe("blocked");
    expect(plan.stages.knowledge.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_document_metadata", path: "v3/REQUIREMENTS.md" }),
        expect.objectContaining({ code: "invalid_document_metadata", path: "v4/DESIGN.md" }),
      ]),
    );

    const humanOutput: string[] = [];
    expect(await runCli(["upgrade"], io(root, humanOutput, errors))).toBe(1);
    expect(humanOutput.join("")).toContain(
      "blocker [invalid_document_metadata] v3/REQUIREMENTS.md",
    );
    expect(humanOutput.join("")).toContain(
      `Independent stages can still apply (terminal_integration): re-run with --apply --approval ${plan.planId}.`,
    );

    expect(
      await runCli(
        ["upgrade", "--apply", "--approval", plan.planId, "--json"],
        io(root, output, errors),
      ),
    ).toBe(1);
    expect(errors).toEqual([]);
    const receipt = JSON.parse(output.join("")) as {
      status: string;
      appliedStages: string[];
      skippedStages: Array<{ stage: string; reason: string }>;
      knowledgeLint: unknown;
      pending: Array<{ stage: string; disposition: string; blockers: Array<{ code: string }> }>;
    };
    expect(receipt.status).toBe("blocked");
    // The event writer stage was deferred behind the hook runtime and applies after it.
    expect(receipt.appliedStages).toEqual(["terminal_integration", "event_writer"]);
    expect(receipt.knowledgeLint).toBeNull();
    expect(receipt.skippedStages).toEqual([
      { stage: "knowledge_lint", reason: "knowledge_stage_blocked" },
      { stage: "node", reason: "knowledge_stage_blocked" },
    ]);
    expect(receipt.pending).toContainEqual(
      expect.objectContaining({
        stage: "knowledge",
        disposition: "blocked",
        blockers: expect.arrayContaining([
          expect.objectContaining({ code: "invalid_document_metadata" }),
        ]),
      }),
    );
    expect(await readFile(resolve(root, runtimePath), "utf8")).toBe(
      await loadTerminalHookRuntime(),
    );
    expect(await readFile(resolve(root, "v3/REQUIREMENTS.md"), "utf8")).toBe(requirements);

    output.length = 0;
    expect(await runCli(["upgrade", "--json"], io(root, output, errors))).toBe(1);
    const after = JSON.parse(output.splice(0).join("")) as {
      planId: string;
      applicableStages: string[];
      stages: { terminalIntegration: { disposition: string } };
    };
    expect(after.stages.terminalIntegration.disposition).toBe("current");
    expect(after.applicableStages).toEqual([]);
    expect(
      await runCli(
        ["upgrade", "--apply", "--approval", after.planId, "--json"],
        io(root, output, errors),
      ),
    ).toBe(1);
    expect(errors).toEqual([]);
    expect(JSON.parse(output.join(""))).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("no independent stage to apply") },
    });
  }, 30_000);

  it("keeps the knowledge stage unblocked by application content and unmatched titles", async () => {
    const root = await repositoryWithInstalledTerminalHooks();
    const data = "apps/web/app/[lang]/docs/_data";
    await mkdir(resolve(root, `${data}/writing-guide`), { recursive: true });
    await mkdir(resolve(root, "misc"), { recursive: true });
    await writeFile(resolve(root, "apps/web/package.json"), '{ "name": "web" }\n');
    await writeFile(
      resolve(root, "apps/web/app/[lang]/docs/page.tsx"),
      'export const guides = join(process.cwd(), "app", "[lang]", "docs", "_data");\n',
    );
    for (const path of [
      `${data}/writing-guide.md`,
      `${data}/writing-guide/korean.md`,
      `${data}/sentences.md`,
      `${data}/vocabulary.md`,
    ])
      await writeFile(resolve(root, path), "# Guide\n\nRendered by the web app.\n");
    await writeFile(resolve(root, "misc/purple-zebra.md"), "# Purple zebra quorum\n\nNotes.\n");

    const output: string[] = [];
    const errors: string[] = [];
    await runCli(["upgrade", "--json"], io(root, output, errors));
    expect(errors).toEqual([]);
    const plan = JSON.parse(output.splice(0).join("")) as {
      stages: {
        knowledge: {
          disposition: string;
          blockers: unknown[];
          deferredDocuments?: Array<{ path: string; reason: string; subject: string }>;
        };
      };
    };
    expect(plan.stages.knowledge.disposition).not.toBe("blocked");
    expect(plan.stages.knowledge.blockers).toEqual([]);
    expect(plan.stages.knowledge.deferredDocuments).toEqual([
      {
        path: "misc/purple-zebra.md",
        reason: "semantic_classification_pending",
        subject: "document",
      },
    ]);

    const humanOutput: string[] = [];
    await runCli(["upgrade"], io(root, humanOutput, errors));
    expect(humanOutput.join("")).toContain(
      "deferred [semantic_classification_pending] misc/purple-zebra.md",
    );
    expect(humanOutput.join("")).not.toContain(data);

    const knowledge = await inspectTerminalRepositoryKnowledge({
      root,
      repositoryRevision: "unrecorded",
      supplementalSources: [],
    });
    expect(knowledge.advisories).toContainEqual({
      code: "document_route_classification_deferred",
      detail: "misc/purple-zebra.md: semantic_classification_pending",
      command: expect.stringContaining("lervo.document.route"),
    });
    expect(knowledge.issues.map((issue) => issue.code)).not.toContain("repository_layout_blocked");
  }, 30_000);
});
