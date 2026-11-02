import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cliCommandCatalog } from "../src/cli-command-catalog.js";
import { runKnowledgeWeb } from "../src/knowledge-web-command.js";
import { cliUsage } from "../src/main.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function git(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", root, "-c", "user.name=Lervo Test", "-c", "user.email=test@lervo.invalid", ...args],
    { encoding: "utf8" },
  ).trim();
}

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), content);
  }
}

async function run(root: string, args: string[]): Promise<{ status: number; value: unknown }> {
  const output: string[] = [];
  const errors: string[] = [];
  const status = await runKnowledgeWeb([...args, "--root", root, "--json"], {
    cwd: root,
    stdout: (message) => output.push(message),
    stderr: (message) => errors.push(message),
  });
  expect(errors.join("")).toBe("");
  return { status, value: JSON.parse(output.join("")) as unknown };
}

describe("CLI command catalog", () => {
  it("reads command words before flags and placeholders", () => {
    expect(
      cliCommandCatalog(
        "Usage:\n  lervo knowledge query [--json] <query>\n  lervo upgrade --apply\n  not lervo x\n  lervo\n",
      ),
    ).toEqual(["lervo knowledge query", "lervo upgrade"]);
    const catalog = cliCommandCatalog(cliUsage);
    expect(catalog).toContain("lervo knowledge web stats");
    expect(catalog).toContain("lervo knowledge web suspects");
    expect(catalog).not.toContain("lervo loop run");
  });
});

describe("lervo knowledge web", () => {
  it("stores the private web and lists documents a change since a revision made suspect", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-web-"));
    roots.push(root);
    git(root, "init", "-q");
    await write(root, {
      "packages/slack/package.json": '{"name":"@lervo/slack"}\n',
      "packages/slack/src/send.ts": "export {};\n",
      "docs/decisions/0001-slack.md":
        "# ADR-0001: Slack\n\nStatus: `accepted`\n\n## Decision\n\nShip @lervo/slack via `lervo knowledge query`.\n",
      "docs/guide.md":
        "# Guide\n\nSee [ADR-0001](decisions/0001-slack.md) and `packages/slack/src/send.ts`.\n",
    });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    const base = git(root, "rev-parse", "HEAD");
    await rm(resolve(root, "packages/slack"), { recursive: true });
    await write(root, {
      "docs/decisions/0002-remove.md":
        "# ADR-0002: Remove Slack\n\nStatus: `accepted`\nSupersedes: [ADR-0001](0001-slack.md)\n",
    });

    const stats = await run(root, ["stats"]);
    expect(stats.status).toBe(0);
    expect(stats.value).toMatchObject({
      refresh: { status: "current", extracted: 3, reused: 0 },
      stats: { documents: 3, edgesByKind: { supersedes: { header: 1 } } },
    });
    expect((await stat(resolve(root, ".lervo/state/relation-web.sqlite"))).mode & 0o777).toBe(
      0o600,
    );

    const suspects = await run(root, ["suspects", "--since", base]);
    expect(suspects.status).toBe(0);
    expect(suspects.value).toMatchObject({
      refresh: { status: "current", extracted: 0, reused: 3 },
      commandsCompared: false,
      removedPackages: ["@lervo/slack"],
      superseded: [
        { document: "docs/decisions/0001-slack.md", by: "docs/decisions/0002-remove.md" },
      ],
    });
    const reasons = Object.fromEntries(
      (
        suspects.value as { suspects: { document: string; reasons: { reason: string }[] }[] }
      ).suspects.map((suspect) => [
        suspect.document,
        suspect.reasons.map((reason) => reason.reason),
      ]),
    );
    expect(reasons).toEqual({
      "docs/decisions/0001-slack.md": ["package_removed"],
      "docs/guide.md": ["path_removed", "target_superseded"],
    });
  });

  it("requires a revision for suspects", async () => {
    const output: string[] = [];
    expect(
      await runKnowledgeWeb(["suspects", "--json"], {
        cwd: tmpdir(),
        stdout: (message) => output.push(message),
        stderr: () => undefined,
      }),
    ).toBe(1);
    expect(output.join("")).toContain("requires --since");
  });
});
