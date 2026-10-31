import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  repositoryKnowledgeBuilt,
} from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import {
  runKnowledgeBootstrap,
  terminalKnowledgeBootstrapNotice,
} from "../src/knowledge-bootstrap.js";
import { runCli } from "../src/main.js";

const roots: string[] = [];
const statePath = ".lervo/state/knowledge/bootstrap.json";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function initializedCheckout(entrypoints: boolean): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-bootstrap-"));
  roots.push(root);
  await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
  if (entrypoints) {
    await writeFile(resolve(root, "README.md"), "# Fixture\n\nA tracked overview.\n");
    await writeFile(resolve(root, "AGENTS.md"), "# Agent instructions\n\nRead README.md.\n");
  }
  const errors: string[] = [];
  expect(
    await runCli(["init", "--minimal", "--name", "bootstrap-fixture"], {
      cwd: root,
      stdout: () => undefined,
      stderr: (message) => errors.push(message),
    }),
    errors.join(""),
  ).toBe(0);
  return root;
}

/** The owner migrated the repository; a colleague's clone lacks every Git-ignored output. */
async function freshCloneOfMigratedRepository(): Promise<string> {
  const root = await initializedCheckout(true);
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" }),
    new Date("2026-10-21T00:00:00.000Z"),
    () => undefined,
  );
  expect(await repositoryKnowledgeBuilt(root)).toBe(true);
  await rm(resolve(root, ".lervo/state/knowledge"), { recursive: true, force: true });
  await rm(resolve(root, "docs/knowledge"), { recursive: true, force: true });
  return root;
}

describe("fresh-checkout knowledge bootstrap", () => {
  it("builds knowledge when the plan writes only Git-ignored projections", async () => {
    const root = await freshCloneOfMigratedRepository();
    const agents = await readFile(resolve(root, "AGENTS.md"), "utf8");
    expect(await repositoryKnowledgeBuilt(root)).toBe(false);

    const state = await runKnowledgeBootstrap({ root });

    expect(state).toMatchObject({ status: "built", reason: null });
    expect(await repositoryKnowledgeBuilt(root)).toBe(true);
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toBe(agents);
    expect(
      await terminalKnowledgeBootstrapNotice({ root, hookRuntime: undefined, now: new Date() }),
    ).toBeNull();
  }, 60_000);

  it("defers instead of changing tracked entrypoints", async () => {
    const root = await initializedCheckout(false);

    const state = await runKnowledgeBootstrap({ root });

    expect(state).toMatchObject({ status: "deferred", reason: "tracked_paths_in_plan" });
    expect(await repositoryKnowledgeBuilt(root)).toBe(false);
    await expect(access(resolve(root, "AGENTS.md"))).rejects.toThrow();
    expect(
      await terminalKnowledgeBootstrapNotice({ root, hookRuntime: undefined, now: new Date() }),
    ).toContain("Ask the owner to review and apply `lervo migrate knowledge`");
  }, 60_000);

  it("starts one detached build and reports it until the build window ends", async () => {
    const root = await initializedCheckout(true);
    const runtime = resolve(root, "noop-runtime.mjs");
    await writeFile(runtime, "");
    const now = new Date("2026-10-21T00:00:00.000Z");

    const first = await terminalKnowledgeBootstrapNotice({ root, hookRuntime: runtime, now });
    const recorded = await readFile(resolve(root, statePath), "utf8");
    const second = await terminalKnowledgeBootstrapNotice({
      root,
      hookRuntime: runtime,
      now: new Date(now.getTime() + 60_000),
    });

    expect(first).toContain("a background build started");
    expect(second).toBe(first);
    expect(await readFile(resolve(root, statePath), "utf8")).toBe(recorded);
    expect(JSON.parse(recorded)).toMatchObject({ status: "in_progress" });
    expect(await terminalKnowledgeBootstrapNotice({ root, hookRuntime: undefined, now })).toContain(
      "a background build started",
    );
  });

  it("says a zero-result query comes from an unbuilt checkout", async () => {
    const root = await initializedCheckout(true);
    const output: string[] = [];

    expect(
      await runCli(["knowledge", "query", "fixture overview", "--json"], {
        cwd: root,
        stdout: (message) => output.push(message),
        stderr: () => undefined,
      }),
    ).toBe(0);

    expect(JSON.parse(output.join(""))).toMatchObject({ knowledgeBuild: "not_built", hits: [] });
  });

  it("tells the agent to build manually when no hook runtime can start a worker", async () => {
    const root = await initializedCheckout(true);

    expect(
      await terminalKnowledgeBootstrapNotice({ root, hookRuntime: undefined, now: new Date() }),
    ).toContain("Run `lervo migrate knowledge`");
  });
});
