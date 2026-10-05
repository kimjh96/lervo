import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import { runCli } from "../src/main.js";

const roots: string[] = [];
const layoutPath = ".lervo/knowledge/document-layout.yaml";
const header = "<!-- lervo:generated repository-knowledge-v1 -->\n";

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

async function materializedRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-refresh-diagnostics-"));
  roots.push(root);
  await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
  expect(await runCli(["init", "--minimal", "--name", "refresh-fixture"], io(root, [], []))).toBe(
    0,
  );
  const output: string[] = [];
  const errors: string[] = [];
  expect(await runCli(["knowledge", "refresh", "--json"], io(root, output, errors))).toBe(0);
  const plan = JSON.parse(output.join("")) as { planId: string };
  expect(
    await runCli(["knowledge", "refresh", "--apply", plan.planId, "--json"], io(root, [], errors)),
    errors.join(""),
  ).toBe(0);
  return root;
}

describe("lervo knowledge refresh diagnostics", () => {
  it("blocks the plan and the apply with the exact layout fields an edit removed", async () => {
    const root = await materializedRepository();
    const layout = parse(await readFile(resolve(root, layoutPath), "utf8")) as {
      routes?: unknown;
      documentPolicy: { rewrite?: unknown };
    };
    delete layout.routes;
    delete layout.documentPolicy.rewrite;
    await writeFile(resolve(root, layoutPath), stringify(layout));

    const output: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["knowledge", "refresh", "--json"], io(root, output, errors))).toBe(1);
    expect(errors).toEqual([]);
    const plan = JSON.parse(output.splice(0).join("")) as {
      planId: string;
      status: string;
      blockers: Array<{ code: string; issues: Array<{ pointer: string; rule: string }> }>;
    };
    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toEqual([
      expect.objectContaining({
        code: "document_layout_contract_invalid",
        issues: [
          expect.objectContaining({ pointer: "/routes", rule: "required" }),
          expect.objectContaining({ pointer: "/documentPolicy/rewrite", rule: "required" }),
        ],
      }),
    ]);

    expect(await runCli(["knowledge", "refresh"], io(root, output, errors))).toBe(1);
    const text = output.splice(0).join("");
    expect(text).toContain("Plan status: blocked");
    expect(text).toContain("blocker [document_layout_contract_invalid] " + layoutPath);
    expect(text).toContain("[required] /documentPolicy/rewrite is required.");
    expect(text).toContain("[required] /routes is required.");

    expect(
      await runCli(
        ["knowledge", "refresh", "--apply", plan.planId, "--json"],
        io(root, output, errors),
      ),
    ).toBe(1);
    expect(errors).toEqual([]);
    expect(JSON.parse(output.splice(0).join(""))).toMatchObject({
      schemaVersion: 1,
      status: "failed",
      error: {
        code: "knowledge_plan_blocked",
        planId: plan.planId,
        blockers: [
          expect.objectContaining({
            issues: [
              expect.objectContaining({ pointer: "/routes" }),
              expect.objectContaining({ pointer: "/documentPolicy/rewrite" }),
            ],
          }),
        ],
      },
    });

    expect(await runCli(["knowledge", "lint", "--json"], io(root, output, errors))).toBe(1);
    expect(errors).toEqual([]);
    expect(JSON.parse(output.splice(0).join(""))).toMatchObject({
      status: "failed",
      error: {
        code: "contract_invalid",
        issues: [
          expect.objectContaining({ pointer: "/routes", rule: "required" }),
          expect.objectContaining({ pointer: "/documentPolicy/rewrite", rule: "required" }),
        ],
      },
    });

    expect(
      await runCli(["knowledge", "refresh", "--apply", plan.planId], io(root, output, errors)),
    ).toBe(1);
    expect(errors.join("")).toContain("[required] /documentPolicy/rewrite is required.");
  }, 30_000);

  it("returns a JSON error envelope instead of stderr text for a stale apply plan ID", async () => {
    const root = await materializedRepository();
    const output: string[] = [];
    const errors: string[] = [];
    expect(
      await runCli(
        ["knowledge", "refresh", "--apply", "kplan_stale", "--json"],
        io(root, output, errors),
      ),
    ).toBe(1);
    expect(errors).toEqual([]);
    expect(JSON.parse(output.join(""))).toMatchObject({
      status: "failed",
      error: { code: "knowledge_plan_stale" },
    });
  }, 30_000);

  it("records generated page regeneration and names the restore command for user-owned bytes", async () => {
    const root = await materializedRepository();
    const index = "docs/knowledge/index.md";
    const generated = await readFile(resolve(root, index), "utf8");
    expect(generated.startsWith(header)).toBe(true);
    await writeFile(resolve(root, index), `${generated}\nLocal edit.\n`);

    const output: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["knowledge", "refresh"], io(root, output, errors))).toBe(0);
    expect(output.splice(0).join("")).toContain(
      `regenerate ${index}: edited generated publication will be replaced by its rebuildable generated bytes`,
    );

    await writeFile(resolve(root, index), "# My own index\n");
    expect(await runCli(["knowledge", "refresh"], io(root, output, errors))).toBe(1);
    expect(output.join("")).toContain(`rm '${index}' && lervo knowledge refresh`);
    expect(await readFile(resolve(root, index), "utf8")).toBe("# My own index\n");
  }, 30_000);
});
