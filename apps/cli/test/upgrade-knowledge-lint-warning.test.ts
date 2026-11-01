import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const lint = vi.hoisted(() => ({ code: 0, report: null as unknown }));
vi.mock("../src/knowledge-command.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/knowledge-command.js")>()),
  runKnowledgeCommand: async (_args: string[], io: { stdout(message: string): void }) => {
    if (lint.report !== null) io.stdout(`${JSON.stringify(lint.report)}\n`);
    return lint.code;
  },
}));

import { formatUpgradeReceipt } from "../src/upgrade-format.js";
import { lintKnowledge } from "../src/upgrade-stage-inspection.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-lint-"));
  roots.push(root);
  return root;
}

describe("upgrade knowledge lint (ordered-stage convergence)", () => {
  it("returns pre-existing content errors as a report instead of stopping the apply", async () => {
    lint.code = 1;
    lint.report = {
      valid: false,
      coverage: "complete",
      issues: [
        { code: "document_directory_file_capacity_exceeded", severity: "error", path: "v6/notes" },
        { code: "document_stale", severity: "warning", path: "docs/a.md" },
      ],
    };
    expect(await lintKnowledge(await repository())).toEqual({ valid: false, issueCount: 2 });
  });

  it("reports a valid repository as valid", async () => {
    lint.code = 0;
    lint.report = { valid: true, coverage: "complete", issues: [] };
    expect(await lintKnowledge(await repository())).toEqual({ valid: true, issueCount: 0 });
  });

  it("stops when lint cannot produce a report", async () => {
    lint.code = 1;
    lint.report = null;
    await expect(lintKnowledge(await repository())).rejects.toThrow(
      "Repository knowledge lint could not produce a report.",
    );
  });

  it("names unresolved content issues in the receipt text without hiding applied stages", () => {
    const text = formatUpgradeReceipt({
      schemaVersion: 1,
      operation: "repository_upgrade",
      approvedPlanId: "upg_000000000000000000000000",
      status: "current",
      appliedStages: ["repository_node", "event_writer"],
      skippedStages: [],
      knowledgeLint: { valid: false, issueCount: 40 },
      nextPlanId: null,
      pending: [],
      cliAcquisition: "outside_repository_upgrade",
    });
    expect(text).toContain("applied: repository_node, event_writer");
    expect(text).toContain("knowledge lint: 40 issue(s) in repository content");
  });
});
