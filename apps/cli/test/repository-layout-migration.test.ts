import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createRepositoryLayoutMigrationPlan } from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import { formatRepositoryLayoutMigrationPlan } from "../src/knowledge-migration-format.js";
import { runCli } from "../src/main.js";
import { planCrossCheck } from "./plan-cross-check-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository layout migration CLI", () => {
  it("bootstraps a Claude-only repository before independently converging the bridge", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-claude-bootstrap-"));
    roots.push(root);
    const original = "# Flemo instructions\n\nKeep provider-neutral policy canonical.\n";
    await writeFile(resolve(root, "CLAUDE.md"), original);
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);

    messages.length = 0;
    expect(await runCli(["terminal", "status", "--json"], io)).toBe(1);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      status: "action_required",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "instruction_canonical_bootstrap_review_required" }),
      ]),
    });

    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io), errors.join("")).toBe(0);
    const adoption = JSON.parse(messages.join("")) as {
      planKind: string;
      planId: string;
      operationId: string;
      approvalHash: string;
      status: string;
    };
    expect(adoption).toMatchObject({
      planKind: "instruction_canonical_bootstrap",
      status: "review_required",
    });
    messages.length = 0;
    // ADR-0561: an independent cross-check agrees, so Lervo applies the adoption itself.
    const crossCheck = planCrossCheck();
    expect(
      await runCli(
        ["migrate", "knowledge", "--apply", adoption.planId, "--json"],
        io,
        crossCheck.services,
      ),
      errors.join(""),
    ).toBe(0);
    expect(crossCheck.checked).toHaveLength(1);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      operation: "instruction_canonical_adoption",
    });
    expect(await readFile(resolve(root, "CLAUDE.md"), "utf8")).toBe(original);
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toContain(original.trimEnd());

    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const structural = JSON.parse(messages.join("")) as {
      planId: string;
      status: string;
    };
    expect(structural.status).toBe("ready");
    messages.length = 0;
    expect(
      await runCli(["migrate", "knowledge", "--apply", structural.planId, "--json"], io),
      errors.join(""),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      type: "knowledge.materialization.applied",
    });

    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const bridge = JSON.parse(messages.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      status: string;
      target: { classification: string };
    };
    expect(bridge).toMatchObject({
      status: "review_required",
      target: { classification: "exact_adopted_duplicate" },
    });
    messages.length = 0;
    expect(
      await runCli(
        ["migrate", "knowledge", "--apply", bridge.planId, "--json"],
        io,
        crossCheck.services,
      ),
      errors.join(""),
    ).toBe(0);
    expect(crossCheck.checked).toHaveLength(2);
    expect(await readFile(resolve(root, "CLAUDE.md"), "utf8")).toBe(
      "<!-- lervo:begin block=provider_entry schema=1 -->\n@AGENTS.md\n<!-- lervo:end block=provider_entry -->\n",
    );
    expect(errors).toEqual([]);
  }, 15_000);

  it("completes plan, cross-checked apply, lint, and idempotent rerun through migrate knowledge", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-layout-migration-"));
    roots.push(root);
    await writeFile(resolve(root, "README.md"), "# Example\n\nSee ARCHITECTURE.md.\n");
    await writeFile(resolve(root, "ARCHITECTURE.md"), "# Architecture\n\nRuntime design.\n");
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      planKind: string;
      status: string;
      moves: Array<{ operationId: string; approvalHash: string }>;
    };
    expect(plan).toMatchObject({ planKind: "repository_layout", status: "review_required" });
    messages.length = 0;
    const { services } = planCrossCheck();
    expect(
      await runCli(["migrate", "knowledge", "--apply", plan.planId, "--json"], io, services),
      errors.join(""),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      operation: "migrate",
      movedCount: 1,
      referenceUpdatedCount: 1,
    });
    await expect(access(resolve(root, "ARCHITECTURE.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(resolve(root, "README.md"), "utf8")).toContain(
      "docs/architecture/system.md",
    );
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const bridge = JSON.parse(messages.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      status: string;
    };
    expect(bridge.status).toBe("review_required");
    messages.length = 0;
    expect(
      await runCli(["migrate", "knowledge", "--apply", bridge.planId, "--json"], io, services),
      errors.join(""),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ operation: "instruction_bridge_update" });
    messages.length = 0;
    const terminalPlanCode = await runCli(["migrate", "knowledge", "--json"], io);
    if (terminalPlanCode !== 0)
      throw new Error(`terminal plan failed: ${errors.join("")} ${messages.join("")}`);
    const terminal = JSON.parse(messages.join("")) as {
      planKind: string;
      planId: string;
      operationId: string;
      approvalHash: string;
      status: string;
    };
    expect(terminal).toMatchObject({ planKind: "terminal_integration", status: "review_required" });
    messages.length = 0;
    expect(
      await runCli(
        [
          "migrate",
          "knowledge",
          "--apply",
          terminal.planId,
          "--approve-item",
          `${terminal.operationId}=${terminal.approvalHash}`,
          "--json",
        ],
        io,
      ),
      errors.join(""),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      operation: "terminal_integration_update",
      activation: {
        status: "action_required",
        requiredOnce: {
          provider: "codex",
          instruction: expect.stringContaining("run /hooks"),
        },
      },
    });
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const refresh = JSON.parse(messages.join("")) as {
      planId: string;
      status: string;
      operations: Array<{ ownership?: string; action: string }>;
    };
    expect(refresh.status).toBe("ready");
    expect(
      refresh.operations.some((item) => item.ownership === "user" && item.action !== "unchanged"),
    ).toBe(false);
    messages.length = 0;
    expect(
      await runCli(["migrate", "knowledge", "--apply", refresh.planId, "--json"], io),
      errors.join(""),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      type: "knowledge.materialization.applied",
    });
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const rerun = JSON.parse(messages.join("")) as {
      planKind: string;
      status: string;
      pendingDocuments: string[];
    };
    expect(rerun).toMatchObject({
      planKind: "document_normalization_provider_selection",
      status: "provider_required",
    });
    expect(rerun.pendingDocuments).toEqual(
      expect.arrayContaining(["CLAUDE.md", "docs/architecture/system.md"]),
    );
    expect(rerun.pendingDocuments).not.toContain("README.md");
    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ valid: true });
    expect(errors).toEqual([]);
  }, 25_000);

  it("reports an unclassified ADR as a deferred document instead of a blocker", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-layout-deferred-"));
    roots.push(root);
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    await mkdir(resolve(root, "docs/adr"), { recursive: true });
    await writeFile(
      resolve(root, "docs/adr/0001-zebra.md"),
      "# ADR-0001: Purple zebra quorum\n\nDecision.\n",
    );
    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    expect(plan.status).not.toBe("blocked");
    expect(plan.blockers).toEqual([]);
    expect(plan.moves).toEqual([]);
    expect(plan.deferredDocuments).toEqual([
      expect.objectContaining({
        subject: "decision",
        path: "docs/adr/0001-zebra.md",
        reason: "semantic_classification_pending",
      }),
    ]);
    expect(formatRepositoryLayoutMigrationPlan(plan)).toContain(
      "deferred [provider_unavailable] docs/adr/0001-zebra.md",
    );
    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      valid: true,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "ungrouped_decision_document", severity: "warning" }),
      ]),
    });
    expect(errors).toEqual([]);
  });
});
