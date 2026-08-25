import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { scanConfiguredRepositoryKnowledge } from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

it("converges provider-neutral observations through exact review and routed promotion", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-development-pattern-"));
  roots.push(root);
  const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
  expect(await runCli(["init"], quiet)).toBe(0);
  await writeFile(
    resolve(root, "AGENTS.md"),
    "# Agent instructions\n\nUse exact review for repository changes.\n",
  );
  await writeFile(
    resolve(root, "README.md"),
    "# Example repository\n\nRepository changes retain durable evidence.\n",
  );
  await writeFile(
    resolve(root, "CLAUDE.md"),
    "# Claude bridge\n\n<!-- lervo:begin block=provider_entry schema=1 -->\n@AGENTS.md\n<!-- lervo:end block=provider_entry -->\n",
  );
  const { scan } = await scanConfiguredRepositoryKnowledge(root);
  const agents = scan.units.find((unit) => unit.path === "AGENTS.md")!;
  const readme = scan.units.find((unit) => unit.path === "README.md")!;
  const proposal = JSON.stringify({
    schemaVersion: 1,
    title: "Evidence-bound repository changes",
    summary: "Use exact plans and rollback when durable evidence cannot commit.",
    scope: "repository changes with durable evidence",
    occurrences: [
      { path: agents.path, locator: agents.locator, independentGroup: "agent-contract" },
      { path: readme.path, locator: readme.locator, independentGroup: "product-entrypoint" },
    ],
    exceptions: ["Read-only inspection has no apply phase."],
    affectedInvariants: ["User-owned bytes require exact approval."],
    reasonsToChange: ["A shared convention makes failure behavior reviewable."],
    verificationCommands: ["pnpm quality:check"],
    target: {
      kind: "repository_instruction",
      path: "docs/instructions/evidence-bound-changes.md",
      content:
        "# Evidence-bound changes\n\nUse a content-bound plan and exact approval for repository mutation. Roll back changed bytes when durable evidence cannot commit.\n",
    },
  });
  const output: string[] = [];
  for (const provider of ["codex", "claude"]) {
    expect(
      await runCli(
        ["knowledge", "pattern", "propose", "--provider", provider, "--stdin", "--json"],
        {
          ...quiet,
          stdin: async () => proposal,
          stdout: (message) => output.push(message),
        },
      ),
    ).toBe(0);
  }
  const observed = JSON.parse(output.at(-1)!) as {
    patternId: string;
    candidateContentHash: string;
    providers: string[];
  };
  expect(observed.providers).toEqual(["claude", "codex"]);

  expect(
    await runCli(
      [
        "knowledge",
        "pattern",
        "review",
        observed.patternId,
        "--decision",
        "defer",
        "--reviewer",
        "repository-maintainer",
        "--approval",
        observed.candidateContentHash,
      ],
      quiet,
    ),
  ).toBe(0);
  expect(
    await runCli(
      [
        "knowledge",
        "pattern",
        "review",
        observed.patternId,
        "--decision",
        "accept",
        "--reviewer",
        "repository-maintainer",
        "--approval",
        observed.candidateContentHash,
      ],
      quiet,
    ),
  ).toBe(0);
  output.length = 0;
  expect(
    await runCli(["knowledge", "pattern", "promote", observed.patternId, "--json"], {
      ...quiet,
      stdout: (message) => output.push(message),
    }),
  ).toBe(0);
  const plan = JSON.parse(output.join("")) as {
    planId: string;
    status: string;
    operations: unknown[];
  };
  expect(plan).toMatchObject({ status: "ready" });
  expect(JSON.stringify(plan)).not.toContain("Use a content-bound plan");
  expect(
    await runCli(
      ["knowledge", "pattern", "promote", observed.patternId, "--apply", "--approval", plan.planId],
      quiet,
    ),
  ).toBe(0);

  expect(
    await readFile(resolve(root, "docs/instructions/evidence-bound-changes.md"), "utf8"),
  ).toContain("exact approval");
  expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toContain(
    "docs/instructions/evidence-bound-changes.md",
  );
  expect(await readFile(resolve(root, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
  await rm(resolve(root, ".lervo/state"), { recursive: true, force: true });
  output.length = 0;
  expect(
    await runCli(["knowledge", "pattern", "status", observed.patternId, "--json"], {
      ...quiet,
      stdout: (message) => output.push(message),
    }),
  ).toBe(0);
  expect(JSON.parse(output.join("")).patterns[0]).toMatchObject({ state: "promoted" });

  output.length = 0;
  expect(
    await runCli(["knowledge", "pattern", "promote", observed.patternId, "--json"], {
      ...quiet,
      stdout: (message) => output.push(message),
    }),
  ).toBe(0);
  expect(JSON.parse(output.join(""))).toMatchObject({
    status: "current",
    sourceFreshness: "stale",
  });
});
