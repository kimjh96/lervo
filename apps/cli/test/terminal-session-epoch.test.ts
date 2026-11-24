import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";

import { terminalEpochPath, type TerminalContextEpoch } from "../src/terminal-context-epoch.js";
import { prepareTerminalSessionStart } from "../src/terminal-session-start.js";

const roots: string[] = [];
const originalHome = process.env.HOME;
let transcriptPath: string;
beforeEach(async () => {
  // The transcript must sit under the provider's own directory, owned by this user.
  const home = await mkdtemp(resolve(tmpdir(), "lervo-epoch-home-"));
  roots.push(home);
  process.env.HOME = home;
  await mkdir(resolve(home, ".claude/projects/fixture"), { recursive: true });
  transcriptPath = resolve(home, ".claude/projects/fixture/session-1.jsonl");
  await writeFile(transcriptPath, `${JSON.stringify({ type: "user", message: "earlier" })}\n`);
});
afterEach(async () => {
  process.env.HOME = originalHome;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const rulePath = (id: string) => `docs/instructions/generated/rule_${id.repeat(24)}.md`;

async function repositoryWithRules(rules: Record<string, string>) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-session-epoch-"));
  roots.push(root);
  await writeFile(resolve(root, "README.md"), "# Fixture\n");
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_sessionepoch" }));
  await mkdir(resolve(root, "docs/instructions/generated"), { recursive: true });
  for (const [id, body] of Object.entries(rules))
    await writeFile(resolve(root, rulePath(id)), body);
  return root;
}

// Real rule files end in a newline and carry blank lines and an exceptions section.
const rules = {
  a: `# Keep hosts aligned\n\n${"Coordinate every host instead of restricting one. ".repeat(4)}\n\n## Exceptions\n\nNone.\n`,
  b: "# Use Korean for owner-facing responses.\n\nRespond to the owner in Korean.\n",
  c: `# A long rule\n\n${"This body does not fit the base rule budget. ".repeat(80)}\n`,
};

async function start(root: string) {
  const base = await prepareTerminalSessionStart({
    root,
    provider: "claude",
    session: {
      event: "SessionStart",
      providerSessionId: "session-1",
      source: "resume",
      transcriptPath,
    },
    deadline: performance.now() + 60_000,
    now: new Date("2026-11-24T00:00:00.000Z"),
  });
  const path = terminalEpochPath(root, "claude", "session-1");
  return {
    base,
    epoch: JSON.parse(await readFile(path, "utf8")) as TerminalContextEpoch,
    mode: (await stat(path)).mode & 0o777,
  };
}

it("records the owner rules the base delivered whole and where its record will appear", async () => {
  const root = await repositoryWithRules(rules);
  const { base, epoch, mode } = await start(root);
  expect(mode).toBe(0o600);
  expect(base).toContain(`Lervo base context for this session resume (epoch ${epoch.epochId}).`);
  expect(base).toContain("Respond to the owner in Korean.");
  expect(base).toContain("## Exceptions");
  // The rule that did not fit is not recorded as delivered.
  expect(base).not.toContain("This body does not fit");
  expect(Object.keys(epoch.baseRules).sort()).toEqual([rulePath("a"), rulePath("b")]);
  // Worker workspaces get a different bookkeeping line, so the base leaves it to each prompt.
  expect(base).not.toContain("If this turn changes repository-authored bytes");
  // The base block's record follows the transcript size at the start.
  expect(epoch.transcriptOffset).toBe((await stat(transcriptPath)).size);

  // A later start replaces the epoch; its own record follows the grown transcript.
  await appendFile(transcriptPath, `${JSON.stringify({ type: "user", message: "later" })}\n`);
  const next = await start(root);
  expect(next.epoch.epochId).not.toBe(epoch.epochId);
  expect(next.epoch.transcriptOffset).toBeGreaterThan(epoch.transcriptOffset);
});

it("keys each recorded rule on its exact section, header included", async () => {
  const root = await repositoryWithRules({ b: rules.b });
  const { base, epoch } = await start(root);
  const section = base.split("\n\n").find((part) => part.includes(rulePath("b")))!;
  // The recorded hash covers the applicability header, not only the rule file's bytes.
  expect(section).toMatch(/^Lervo applied owner rule \(applicable; /u);
  const { sha256 } = await import("@lervo/repository-knowledge");
  expect(epoch.baseRules[rulePath("b")]).toBe(
    sha256(`${section}\n\nRespond to the owner in Korean.\n`),
  );
});
