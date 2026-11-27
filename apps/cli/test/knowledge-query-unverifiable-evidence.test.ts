// ADR-0649: recorded verification evidence never blocks the repository's rules. The field case: a
// verification recorded into the registered repository for a suite its main checkout lacks made
// every query fail closed, in a conversation worktree during an open turn and in the main checkout
// alike, so the agent wrote without loading any rule. Such a result is now bound to the suite hash
// it recorded on every path, and `lervo knowledge query` leaves out what still cannot be verified.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import { collectLocalKnowledgeSources as collectManagedSearchSources } from "@lervo/repository-context";
import { loadVerificationSuite, runVerificationSuite } from "@lervo/verification";
import { afterEach, describe, expect, it } from "vitest";

import { collectLocalKnowledgeSources } from "../src/knowledge-sources.js";
import { runCli } from "../src/main.js";
import { claimFixture, git, type ClaimFixture } from "./conversation-claim-fixture.js";

const RULE = `docs/instructions/generated/rule_${"c".repeat(24)}.md`;
const RULE_TEXT = "Keep every note under notes/ in plain Markdown.";
const QUERY = ["knowledge", "query", "--path", "notes/canary.md", "create a notes file"];
const POLICY = `sha256:${"a".repeat(64)}`;

let fixture: ClaimFixture | undefined;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

async function cli(cwd: string, args: string[], stdin?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, {
    cwd,
    stdout: (message) => out.push(message),
    stderr: (message) => err.push(message),
    ...(stdin === undefined ? {} : { stdin: async () => stdin }),
  });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

/** The conversation fixture's repository with one owner rule for `notes/**`, committed. */
async function repositoryWithRule(): Promise<ClaimFixture> {
  fixture = await claimFixture();
  await mkdir(resolve(fixture.repository, "docs/instructions/generated"), { recursive: true });
  await writeFile(
    resolve(fixture.repository, RULE),
    `---\npaths: ["notes/**"]\n---\n# Notes\n${RULE_TEXT}\n`,
  );
  await git(fixture.repository, "add", "-A");
  await git(fixture.repository, "commit", "-m", "Add the notes rule");
  return fixture;
}

/**
 * Runs a suite that exists only in the worktree and records its completion into the registered
 * repository, where a linked checkout's evidence belongs: the main checkout has no such suite.
 */
async function recordWorktreeOnlyVerification(
  repository: string,
  worktree: string,
): Promise<string> {
  await mkdir(resolve(worktree, ".lervo/verifications"), { recursive: true });
  await writeFile(
    resolve(worktree, ".lervo/verifications/branch.check.yaml"),
    [
      "schemaVersion: 1",
      "suiteId: branch.check",
      "stopOnFailure: true",
      "commands:",
      "  - commandId: node",
      "    executable: node",
      '    arguments: ["--version"]',
      "    cwd: .",
      "    timeoutMs: 30000",
      "    maxOutputBytes: 65536",
      "    environmentVariableNames: []",
      "",
    ].join("\n"),
  );
  const suite = await loadVerificationSuite(worktree, "branch.check");
  const revision = `sha256:${"e".repeat(64)}`;
  const storage = await openProjectStorage(repository);
  try {
    const { result, resultArtifact } = await runVerificationSuite({
      suite,
      repositoryRoot: worktree,
      repositoryRevision: revision,
      captureRepositoryRevision: async () => revision,
      artifactStore: storage.artifacts,
    });
    storage.events.append({
      eventId: "evt_worktreeverification",
      projectId: storage.manifest.projectId,
      runId: "run_worktreeverification",
      sessionId: "ses_worktreeverification",
      type: "verification.completed",
      occurredAt: result.completedAt,
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion: POLICY,
      payload: {
        verificationId: result.verificationId,
        suiteId: result.suiteId,
        suiteHash: result.suiteHash,
        repositoryRevision: result.repositoryRevision,
        status: result.status,
        resultArtifactId: resultArtifact.artifactId,
        resultContentHash: resultArtifact.contentHash,
        nonPassedCommandIds: [],
      },
    });
    return result.verificationId;
  } finally {
    await storage.close();
  }
}

/**
 * The field's other event: a completion for suite `agent.context`, which no checkout defines,
 * whose stored original is not a verification result, so no path can verify it.
 */
async function recordUnverifiableVerification(repository: string): Promise<void> {
  const storage = await openProjectStorage(repository);
  try {
    const summary = await storage.artifacts.put("Prefer exact source-bound evidence.");
    storage.events.append({
      eventId: "evt_unverifiableverification",
      projectId: storage.manifest.projectId,
      runId: "run_unverifiableverification",
      sessionId: "ses_unverifiableverification",
      type: "verification.completed",
      occurredAt: "2026-11-27T00:00:00.000Z",
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion: POLICY,
      payload: {
        verificationId: `ver_${"b".repeat(16)}`,
        suiteId: "agent.context",
        suiteHash: `sha256:${"c".repeat(64)}`,
        repositoryRevision: `sha256:${"d".repeat(64)}`,
        status: "passed",
        resultArtifactId: `art_${summary.contentHash.slice("sha256:".length)}`,
        resultContentHash: summary.contentHash,
        nonPassedCommandIds: [],
      },
    });
  } finally {
    await storage.close();
  }
}

async function eventCount(repository: string, type: string): Promise<number> {
  const storage = await openProjectStorage(repository);
  try {
    return storage.events.list({ types: [type] }).length;
  } finally {
    await storage.close();
  }
}

describe("knowledge query with recorded evidence it cannot verify", () => {
  it("binds a worktree-only suite's result on the strict paths the turn and Stop use", async () => {
    const { repository, first } = await repositoryWithRule();
    const verificationId = await recordWorktreeOnlyVerification(repository, first.worktree);
    // Owner-rule intake, turn declaration, and Stop's lifecycle inspection use the first
    // collector; managed search the second. Both stay fail-closed and now accept the result.
    for (const sources of [
      await collectLocalKnowledgeSources(repository),
      await collectManagedSearchSources(repository),
    ])
      expect(sources.map((source) => source.path)).toContain(`@verification/${verificationId}`);
    const json = await cli(first.worktree, [...QUERY.slice(0, 2), "--json", ...QUERY.slice(2)]);
    expect(json.code, json.stderr).toBe(0);
    expect((JSON.parse(json.stdout) as { evidence: unknown }).evidence).toEqual({
      verificationResults: { status: "complete" },
      executionEvents: { status: "complete" },
    });
  }, 120_000);

  it("returns the rules during an open turn in a conversation worktree and in the main checkout", async () => {
    const { repository, first } = await repositoryWithRule();
    await recordWorktreeOnlyVerification(repository, first.worktree);
    await recordUnverifiableVerification(repository);

    // The lead's turn opens as its UserPromptSubmit hook leaves it, before the agent queries.
    const prompt = await cli(
      first.worktree,
      ["terminal", "hook", "--provider", "claude", "--contract", "2"],
      JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        session_id: first.sessionId,
        prompt: "create a notes file",
      }),
    );
    expect(prompt.code, prompt.stderr).toBe(0);
    expect(await eventCount(repository, "terminal.context.prepared")).toBe(1);
    expect(await eventCount(repository, "terminal.turn.observed")).toBe(0);

    for (const checkout of [first.worktree, repository]) {
      const text = await cli(checkout, QUERY);
      expect(text.stderr).not.toContain("cannot be verified safely and completely");
      expect(text.code, text.stderr).toBe(0);
      expect(text.stdout).toContain(RULE_TEXT);
      expect(text.stdout).toContain(
        "Evidence degraded: 1 recorded verification result could not be verified against its suite or stored original and was left out of the search; repository files and owner rules are unaffected.",
      );

      const json = await cli(checkout, [...QUERY.slice(0, 2), "--json", ...QUERY.slice(2)]);
      expect(json.code, json.stderr).toBe(0);
      const parsed = JSON.parse(json.stdout) as {
        evidence: unknown;
        instructions: { context: string | null; report: { status: string } };
      };
      expect(parsed.evidence).toEqual({
        verificationResults: { status: "partial", omittedCount: 1 },
        executionEvents: { status: "complete" },
      });
      expect(parsed.instructions.report.status).toBe("complete");
      expect(parsed.instructions.context).toContain(RULE_TEXT);
    }
  }, 120_000);

  it("leaves out a verification history it cannot read and still answers", async () => {
    const { repository } = await repositoryWithRule();
    const storage = await openProjectStorage(repository);
    try {
      // Two completions of one verification that disagree: the history itself is unverifiable.
      for (const [index, status] of (["passed", "failed"] as const).entries())
        storage.events.append({
          eventId: `evt_conflictingverification${index}`,
          projectId: storage.manifest.projectId,
          runId: "run_conflictingverification",
          sessionId: "ses_conflictingverification",
          type: "verification.completed",
          occurredAt: "2026-11-27T00:00:00.000Z",
          actor: { kind: "system" },
          schemaVersion: 1,
          policyVersion: POLICY,
          payload: {
            verificationId: `ver_${"f".repeat(16)}`,
            suiteId: "absent.suite",
            suiteHash: `sha256:${"c".repeat(64)}`,
            repositoryRevision: `sha256:${"d".repeat(64)}`,
            status,
            resultArtifactId: `art_${"b".repeat(64)}`,
            resultContentHash: `sha256:${"b".repeat(64)}`,
            nonPassedCommandIds: [],
          },
        });
    } finally {
      await storage.close();
    }
    const text = await cli(repository, QUERY);
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toContain(RULE_TEXT);
    expect(text.stdout).toContain(
      "Evidence degraded: the recorded verification history could not be verified, so verification results were left out of the search; repository files and owner rules are unaffected.",
    );
  }, 120_000);
});
