import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import { capturePlanItem } from "@lervo/repository-knowledge-runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runEventContractCommand } from "../src/event-contract-command.js";
import { runPlanCommand } from "../src/plan-command.js";
import { terminalPlanContextLines } from "../src/terminal-plan-context.js";
import type { CliIo } from "../src/types.js";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function io(root: string, stdin = "") {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const value: CliIo = {
    cwd: root,
    stdin: async () => stdin,
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  };
  return { value, stdout, stderr };
}

/** A committed repository whose local event writer selected schema 9 through the real activation. */
async function repository(activate = true): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-plan-command-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_plancommand1" }));
  const git = (...args: string[]) =>
    execute("git", ["-C", root, "-c", "user.name=T", "-c", "user.email=t@lervo.invalid", ...args]);
  await git("init", "-q", "-b", "main");
  await writeFile(resolve(root, "README.md"), "# Fixture\n");
  await git("add", "README.md");
  await git("commit", "-q", "-m", "fixture");
  if (activate) {
    const evidence = io(root);
    expect(await runEventContractCommand(["evidence", "--json"], evidence.value)).toBe(0);
    const plan = io(root, evidence.stdout.join(""));
    expect(
      await runEventContractCommand(
        ["activate", "--stdin", "--schema-version", "9", "--json"],
        plan.value,
      ),
    ).toBe(0);
    const planId = JSON.parse(plan.stdout.join("")).planId as string;
    const applied = io(root, evidence.stdout.join(""));
    expect(
      await runEventContractCommand(
        ["activate", "--stdin", "--schema-version", "9", "--apply", planId, "--json"],
        applied.value,
      ),
      applied.stderr.join(""),
    ).toBe(0);
  }
  return { root, head: (await git("rev-parse", "HEAD")).stdout.trim() };
}

async function plan(root: string, ...args: string[]) {
  const output = io(root);
  const code = await runPlanCommand([...args, "--json"], output.value);
  return { code, value: JSON.parse(output.stdout.join("")) };
}

describe("lervo plan (ADR-0563)", () => {
  it("keeps a tree, delivers open items to each turn, and closes only with evidence", async () => {
    const { root, head } = await repository();
    const objective = await plan(root, "add", "--kind", "objective", "--title", "Core loop");
    expect(objective.code).toBe(0);
    const step = await plan(
      root,
      "add",
      "--parent",
      objective.value.item.itemId,
      "--title",
      "Plan ledger slice 1",
    );
    expect(step.value.item).toMatchObject({ parentId: objective.value.item.itemId, state: "open" });
    expect((await plan(root, "start", step.value.item.itemId)).value.item.state).toBe(
      "in_progress",
    );

    const storage = await openProjectStorage(root);
    try {
      // An unconfirmed candidate never reaches a turn.
      capturePlanItem(storage, {
        parentId: null,
        kind: "plan",
        title: "Unconfirmed candidate",
        state: "candidate",
        source: {
          origin: "transcript",
          provider: "claude",
          sessionDigest: null,
          transcriptOffset: null,
        },
      });
      expect(terminalPlanContextLines(storage)).toEqual([
        expect.stringMatching(/^Lervo plan: 2 open items;/u),
        `- [in_progress] Plan ledger slice 1 (${step.value.item.itemId})`,
        `- [open] Core loop (${objective.value.item.itemId})`,
      ]);
    } finally {
      await storage.close();
    }

    const unproven = await plan(root, "done", step.value.item.itemId, "--reason", "Shipped");
    expect(unproven).toMatchObject({
      code: 1,
      value: { error: { code: "plan_item_evidence_required" } },
    });
    const done = await plan(
      root,
      "done",
      step.value.item.itemId,
      "--reason",
      "Landed on main",
      "--commit",
      head,
      "--branch",
      "main",
    );
    expect(done.value.item).toMatchObject({ state: "done", closed: { evidence: [{ ref: head }] } });
    // The list shows every open item, the unconfirmed candidate included; the turn did not.
    const listed = await plan(root, "list");
    expect(listed.value.items.map((item: { title: string }) => item.title)).toEqual([
      "Core loop",
      "Unconfirmed candidate",
    ]);
    expect((await plan(root, "list", "--all")).value.items).toHaveLength(3);
  });

  it("refuses to write before schema 9 is active and gives a turn no plan lines", async () => {
    const { root } = await repository(false);
    expect(await plan(root, "add", "--title", "Too early")).toMatchObject({
      code: 1,
      value: { error: { code: "plan_ledger_inactive" } },
    });
    const storage = await openProjectStorage(root);
    try {
      expect(terminalPlanContextLines(storage)).toEqual([]);
    } finally {
      await storage.close();
    }
  });
});
