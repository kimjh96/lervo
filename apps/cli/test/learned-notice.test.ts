import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { recordEffectNotice } from "@lervo/project";
import { describe, expect, it } from "vitest";

import { formatLearnedNotice } from "../src/learned-notice-format.js";
import { projectLearnedNotice } from "../src/learned-notice-projection.js";
import {
  readLearnedNotice,
  readLearnedNoticeCursor,
  writeLearnedNotice,
  writeLearnedNoticeCursor,
} from "../src/learned-notice-state.js";

const lervo = {
  GIT_AUTHOR_NAME: "Lervo Knowledge",
  GIT_AUTHOR_EMAIL: "knowledge@lervo.invalid",
  GIT_COMMITTER_NAME: "Lervo Knowledge",
  GIT_COMMITTER_EMAIL: "knowledge@lervo.invalid",
};
const developer = {
  GIT_AUTHOR_NAME: "Developer",
  GIT_AUTHOR_EMAIL: "dev@example.invalid",
  GIT_COMMITTER_NAME: "Developer",
  GIT_COMMITTER_EMAIL: "dev@example.invalid",
};

function git(root: string, args: string[], env: Record<string, string> = developer): string {
  return execFileSync("git", ["-C", root, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  }).trim();
}

async function commit(
  root: string,
  files: Record<string, string>,
  subject: string,
  env: Record<string, string>,
): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  git(root, ["add", "-A"], env);
  git(root, ["commit", "-q", "-m", subject], env);
  return git(root, ["rev-parse", "HEAD"]);
}

async function repository(): Promise<{ root: string; base: string }> {
  const root = await mkdtemp(join(tmpdir(), "lervo-learned-"));
  git(root, ["init", "-q", "-b", "main"]);
  const base = await commit(root, { "README.md": "# Repo\n" }, "chore: start", developer);
  return { root, base };
}

describe("learned notice", () => {
  it("reports owner rules, skills, canon with added links, and background updates after the cursor", async () => {
    const { root, base } = await repository();
    await commit(root, { "src/a.ts": "export {};\n" }, "feat: develop", developer);
    await commit(
      root,
      { "docs/instructions/generated/rule_1.md": "# Answer in Korean\n" },
      "docs: apply a reviewed owner rule",
      lervo,
    );
    await commit(
      root,
      {
        "docs/specifications/flow.md":
          "# Flow\n\nSee [the design](../architecture/design.md) and [web](https://example.com).\n",
        ".agents/skills/deploy/SKILL.md": "# Deploy\n",
      },
      "docs: apply reviewed canonical knowledge",
      lervo,
    );
    const head = await commit(
      root,
      { "docs/guide.md": "# Guide\n", "docs/index.md": "# Index\n" },
      "docs: apply reviewed background knowledge",
      lervo,
    );

    const notice = await projectLearnedNotice({ root, shownThrough: base, now: new Date() });
    expect(notice).toMatchObject({
      throughCommit: head,
      counts: { owner_rule: 1, skill: 1, canonical: 1, updated: 1 },
    });
    expect(notice!.entries).toContainEqual({
      kind: "canonical",
      path: "docs/specifications/flow.md",
      title: "Flow",
      links: ["docs/architecture/design.md"],
    });
    expect(notice!.entries).toContainEqual(
      expect.objectContaining({ kind: "skill", path: ".agents/skills/deploy", title: "deploy" }),
    );
    const line = formatLearnedNotice(notice!)!;
    expect(line).toContain('owner rule "Answer in Korean"');
    expect(line).toContain("links docs/architecture/design.md");
    expect(line).toContain("no action needed");
    expect(line.indexOf("owner rule")).toBeLessThan(line.indexOf("updated docs/guide.md"));

    const after = await projectLearnedNotice({ root, shownThrough: head, now: new Date() });
    expect(after).toMatchObject({ throughCommit: head, entries: [] });
    expect(formatLearnedNotice(after!)).toBeNull();
  });

  it("reports a stored owner rule with the rule it replaced, a retired rule, and the undo", async () => {
    const { root, base } = await repository();
    const older = `docs/instructions/generated/rule_${"a".repeat(24)}.md`;
    const newer = `docs/instructions/generated/rule_${"b".repeat(24)}.md`;
    const retired = `docs/instructions/generated/rule_${"c".repeat(24)}.md`;
    await commit(
      root,
      { [older]: "# Older rule\n", [retired]: "# Retired rule\n" },
      "chore: seed rules",
      developer,
    );
    await rm(join(root, older));
    await commit(root, { [newer]: "# Scoped commits\n" }, "docs: apply an owner rule", lervo);
    await rm(join(root, retired));
    const head = await commit(root, {}, "docs: retire an owner rule", lervo);

    const notice = await projectLearnedNotice({ root, shownThrough: base, now: new Date() });
    expect(notice).toMatchObject({ throughCommit: head, counts: { owner_rule: 2 } });
    expect(notice!.entries).toEqual(
      expect.arrayContaining([
        { kind: "owner_rule", path: newer, title: "Scoped commits", links: [], replaced: [older] },
        { kind: "owner_rule", path: retired, title: null, links: [], retired: true },
      ]),
    );
    const line = formatLearnedNotice(notice!)!;
    expect(line).toContain(
      `stored owner rule "Scoped commits" (${newer}) (replaced rule_${"a".repeat(24)})`,
    );
    expect(line).toContain(`retired owner rule rule_${"c".repeat(24)}`);
    expect(line).toContain("undo a rule: lervo knowledge instruction retire <rule-id>");
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(480);
  });

  it("restarts from the first-run window when the cursor is no longer reachable", async () => {
    const { root } = await repository();
    const head = await commit(
      root,
      { "docs/guide.md": "# Guide\n" },
      "docs: apply reviewed background knowledge",
      lervo,
    );
    const notice = await projectLearnedNotice({
      root,
      shownThrough: "f".repeat(40),
      now: new Date(),
    });
    expect(notice).toMatchObject({ throughCommit: head, counts: { updated: 1 } });
  });

  it("covers the whole range up to HEAD so merged branches are never revisited", async () => {
    const { root, base } = await repository();
    git(root, ["checkout", "-q", "-b", "side"]);
    await commit(
      root,
      { "docs/side.md": "# Side\n" },
      "docs: apply reviewed background knowledge",
      lervo,
    );
    git(root, ["checkout", "-q", "main"]);
    await commit(
      root,
      { "docs/main.md": "# Main\n" },
      "docs: apply reviewed background knowledge",
      lervo,
    );
    git(root, ["merge", "-q", "--no-edit", "side"]);
    const head = git(root, ["rev-parse", "HEAD"]);
    const first = await projectLearnedNotice({ root, shownThrough: base, now: new Date() });
    expect(first).toMatchObject({ throughCommit: head, counts: { updated: 2 } });
    const again = await projectLearnedNotice({ root, shownThrough: head, now: new Date() });
    expect(again).toMatchObject({ throughCommit: head, entries: [] });
  });

  it("restarts from the first-run window when the cursor exists but is not an ancestor", async () => {
    const { root } = await repository();
    git(root, ["checkout", "-q", "-b", "other"]);
    const elsewhere = await commit(
      root,
      { "docs/other.md": "# Other\n" },
      "docs: apply reviewed background knowledge",
      lervo,
    );
    git(root, ["checkout", "-q", "main"]);
    const head = await commit(
      root,
      { "docs/가이드.md": "# 가이드\n" },
      "docs: apply reviewed background knowledge",
      lervo,
    );
    const notice = await projectLearnedNotice({ root, shownThrough: elsewhere, now: new Date() });
    expect(notice).toMatchObject({ throughCommit: head, counts: { updated: 1 } });
    expect(notice!.entries).toEqual([
      { kind: "updated", path: "docs/가이드.md", title: "가이드", links: [] },
    ]);
  });

  it("reports each freshness apply with its reason, cross-check, and undo command (ADR-0561)", async () => {
    const { root, base } = await repository();
    const candidate = "kfresh_0123456789abcdef01234567";
    await mkdir(join(root, "docs/archive"), { recursive: true });
    await writeFile(join(root, "docs/archive/old.md"), "# Old\n");
    await writeFile(join(root, "README.md"), "# Repo v4\n");
    git(root, ["add", "-A"], lervo);
    git(
      root,
      [
        "commit",
        "-q",
        "-m",
        "docs: refresh README.md from evidence",
        "-m",
        [
          `Lervo-Freshness-Candidate: ${candidate}`,
          "Lervo-Freshness-Reason: reference_target_missing",
          "Lervo-Freshness-Cross-Check: agreement 2/2 (claude run_a; codex run_b)",
        ].join("\n"),
      ],
      lervo,
    );
    const notice = await projectLearnedNotice({ root, shownThrough: base, now: new Date() });
    expect(notice).toMatchObject({ counts: { freshness: 1, updated: 0 } });
    expect(notice!.entries).toEqual([
      {
        kind: "freshness",
        path: "README.md",
        title: null,
        links: [],
        freshness: {
          effect: "refresh",
          targets: ["README.md", "docs/archive/old.md"],
          reason: "reference_target_missing",
          crossCheck: { reviewers: ["claude run_a", "codex run_b"], verdict: "agree" },
          undo: `lervo knowledge freshness revert ${candidate}`,
        },
      },
    ]);
    expect(formatLearnedNotice(notice!)).toContain(
      `refreshed README.md (reason reference_target_missing; cross-check agree by claude run_a, codex run_b; undo: lervo knowledge freshness revert ${candidate})`,
    );
  });

  it("reports a cross-checked layout commit with its reason, reviewer, and undo (ADR-0561)", async () => {
    const { root, base } = await repository();
    await mkdir(join(root, "docs/operations"), { recursive: true });
    await writeFile(join(root, "docs/operations/TRACE.md"), "# Trace\n");
    git(root, ["add", "-A"], lervo);
    git(
      root,
      [
        "commit",
        "-q",
        "-m",
        "docs: apply the cross-checked repository layout",
        "-m",
        [
          "Lervo-Effect: repository_layout",
          "Lervo-Effect-Plan: klayout_0123",
          "Lervo-Effect-Reason: moved 19 documents to their classified routes, rewrote 4 references",
          "Lervo-Effect-Cross-Check: lifecycle reviewer agt_reviewer approved",
        ].join("\n"),
      ],
      lervo,
    );
    const head = git(root, ["rev-parse", "HEAD"]).trim();
    const notice = await projectLearnedNotice({ root, shownThrough: base, now: new Date() });
    expect(notice).toMatchObject({ counts: { effect: 1, updated: 0 } });
    expect(notice!.entries).toEqual([
      {
        kind: "effect",
        path: `repository_layout@${head.slice(0, 12)}`,
        title: null,
        links: [],
        effect: {
          effect: "repository_layout",
          targets: ["docs/operations/TRACE.md"],
          reason: "moved 19 documents to their classified routes, rewrote 4 references",
          crossCheck: { reviewers: ["lifecycle reviewer agt_reviewer"], verdict: "agree" },
          undo: `lervo knowledge revert ${head}`,
        },
      },
    ]);
    expect(formatLearnedNotice(notice!)).toContain(
      `applied repository layout on docs/operations/TRACE.md (reason moved 19 documents to their classified routes, rewrote 4 references; cross-check agree by lifecycle reviewer agt_reviewer; undo: lervo knowledge revert ${head})`,
    );
  });

  it("reports journal effects without a commit beside the commits, once (ADR-0561)", async () => {
    const { root, base } = await repository();
    const now = new Date();
    await recordEffectNotice(root, {
      noticeId: "terminal_integration:lbk_one",
      occurredAt: new Date(now.getTime() - 60_000).toISOString(),
      effect: "terminal_integration",
      targets: [".claude/settings.json"],
      reason: "merged the Lervo hooks into the provider hook files",
      crossCheck: { reviewers: ["post-apply verification"], verdict: "verified" },
      undo: "lervo state restore lbk_one",
    });
    const notice = await projectLearnedNotice({
      root,
      shownThrough: base,
      noticesShownThrough: null,
      now,
    });
    expect(notice).toMatchObject({ counts: { effect: 1 }, noticesThrough: expect.any(String) });
    expect(notice!.entries[0]).toMatchObject({
      kind: "effect",
      effect: {
        effect: "terminal_integration",
        targets: [".claude/settings.json"],
        crossCheck: { reviewers: ["post-apply verification"], verdict: "verified" },
        undo: "lervo state restore lbk_one",
      },
    });
    expect(formatLearnedNotice(notice!)).toContain(
      "applied terminal integration on .claude/settings.json (reason merged the Lervo hooks into the provider hook files; cross-check verified by post-apply verification; undo: lervo state restore lbk_one)",
    );
    const shown = await projectLearnedNotice({
      root,
      shownThrough: base,
      noticesShownThrough: notice!.noticesThrough!,
      now,
    });
    expect(shown).toMatchObject({ counts: { effect: 0 } });
    expect(shown!.noticesThrough).toBeUndefined();
  });

  it("keeps a long quoted undo command whole and refuses one it would have to cut (ADR-0561)", async () => {
    const { root, base } = await repository();
    const notice = (undo: string) => ({
      noticeId: `replica_backup:${undo.length}`,
      occurredAt: new Date().toISOString(),
      effect: "replica_backup",
      targets: ["shiflo"],
      reason: "saved the peer side",
      crossCheck: { reviewers: ["backup branch snapshot check"], verdict: "agree" },
      undo,
    });
    const long = `lervo-node repository-replica restore --config '/Users/owner/${"Application Support/".repeat(20)}c.json' --replica shiflo`;
    expect(long.length).toBeGreaterThan(300);
    await recordEffectNotice(root, notice(long));
    const projected = await projectLearnedNotice({
      root,
      shownThrough: base,
      noticesShownThrough: null,
      now: new Date(),
    });
    expect(projected!.entries.find((entry) => entry.kind === "effect")).toMatchObject({
      effect: { undo: long },
    });
    await expect(recordEffectNotice(root, notice("x".repeat(2049)))).rejects.toThrow(
      "at most 2048 characters",
    );
  });

  it("keeps the line within its byte cap and counts what it omits", () => {
    const entries = Array.from({ length: 16 }, (_, index) => ({
      kind: "updated" as const,
      path: `docs/a-very-long-directory-name/document-number-${index}.md`,
      title: null,
      links: [],
    }));
    const line = formatLearnedNotice({
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      throughCommit: "a".repeat(40),
      counts: { owner_rule: 0, skill: 0, canonical: 0, freshness: 0, effect: 0, updated: 40 },
      entries,
    })!;
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(480);
    expect(line).toMatch(/; \d+ more; details/u);
  });

  it("round-trips the notice and cursor state and rejects invalid files", async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-learned-state-"));
    expect(await readLearnedNotice(root)).toBeNull();
    expect(await readLearnedNoticeCursor(root)).toBeNull();
    const notice = {
      schemaVersion: 1 as const,
      observedAt: new Date().toISOString(),
      throughCommit: "b".repeat(40),
      counts: { owner_rule: 1, skill: 0, canonical: 0, freshness: 0, effect: 0, updated: 0 },
      entries: [{ kind: "owner_rule" as const, path: "docs/r.md", title: null, links: [] }],
    };
    await writeLearnedNotice(root, notice);
    expect(await readLearnedNotice(root)).toEqual(notice);
    await writeLearnedNoticeCursor(
      root,
      { throughCommit: "b".repeat(40), noticesThrough: notice.observedAt },
      notice.observedAt,
    );
    expect(await readLearnedNoticeCursor(root)).toMatchObject({
      shownThrough: "b".repeat(40),
      noticesShownThrough: notice.observedAt,
    });
    await writeFile(join(root, ".lervo/state/learned-notice.json"), '{"schemaVersion":2}');
    expect(await readLearnedNotice(root)).toBeNull();
  });
});
