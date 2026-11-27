import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { inspectRepositoryCoordinationHome, openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { changedPaths, heldPaths, learnedEntries } from "../src/core-link-agent-context.js";
import { recordHostedLaunch } from "../src/hosted-launch-records.js";
import { runCli } from "../src/main.js";

const roots: string[] = [];
const hash = (character: string) => `sha256:${character.repeat(64)}`;

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

function io(cwd: string, stdout: string[] = [], stdin?: string) {
  return {
    cwd,
    stdout: (message: string) => stdout.push(message),
    stderr: () => undefined,
    ...(stdin === undefined ? {} : { stdin: async () => stdin }),
  };
}

async function hire(root: string): Promise<string> {
  const output: string[] = [];
  expect(
    await runCli(["agent", "hire", "--role", "developer", "--write", "--json"], io(root, output)),
  ).toBe(0);
  return (JSON.parse(output.join("")) as { agentId: string }).agentId;
}

/** Promotes `summary` for `agentId`, with a review whose result is that summary. */
async function promote(
  root: string,
  agentId: string,
  input: { summary: string; subject: string; sensitivity?: "restricted"; observedAt: string },
): Promise<void> {
  const storage = await openProjectStorage(root);
  let review: { eventId: string; eventHash: string };
  try {
    const result = await storage.artifacts.put(input.summary);
    review = storage.events.append({
      eventId: `evt_review${input.subject.replace(/[^a-z]/gu, "")}`,
      projectId: storage.manifest.projectId,
      runId: "run_contextreview01",
      sessionId: "ses_contextreview01",
      type: "verification.completed",
      occurredAt: "2026-11-01T00:00:00.000Z",
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion: hash("a"),
      payload: {
        verificationId: `ver_${"b".repeat(16)}`,
        suiteId: "agent.context",
        suiteHash: hash("c"),
        repositoryRevision: hash("d"),
        status: "passed",
        resultArtifactId: `art_${result.contentHash.slice("sha256:".length)}`,
        resultContentHash: result.contentHash,
        nonPassedCommandIds: [],
      },
    }).event;
  } finally {
    await storage.close();
  }
  const promoted = await runCli(
    [
      "agent",
      "context",
      "promote",
      "--agent",
      agentId,
      "--layer",
      "expertise",
      "--kind",
      "expertise",
      "--subject",
      input.subject,
      "--retrieval-term",
      input.subject,
      "--source-kind",
      "event",
      "--source-id",
      review.eventId,
      "--source-hash",
      review.eventHash,
      "--review-event",
      review.eventId,
      "--observed-at",
      input.observedAt,
      ...(input.sensitivity === undefined ? [] : ["--sensitivity", input.sensitivity]),
      "--summary-stdin",
      "--write",
    ],
    io(root, [], input.summary),
  );
  expect(promoted).toBe(0);
}

describe("what an agent has learned, for its profile", () => {
  it("lists its active entries newest first, keeps a restricted one's words, and knows its agents", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-learned-"));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "learned"], io(root))).toBe(0);
    const agentId = await hire(root);
    const quiet = await hire(root);
    expect(await learnedEntries(root, quiet)).toEqual([]);
    await promote(root, agentId, {
      summary: "Prefer exact source-bound evidence.",
      subject: "evidence-binding",
      observedAt: "2026-11-02T00:00:00.000Z",
    });
    await promote(root, agentId, {
      summary: "The billing service retries twice.",
      subject: "billing-retries",
      sensitivity: "restricted",
      observedAt: "2026-11-03T00:00:00.000Z",
    });
    expect(await learnedEntries(root, agentId)).toEqual([
      expect.objectContaining({
        layer: "expertise",
        kind: "expertise",
        subject: "billing-retries",
        observedAt: "2026-11-03T00:00:00.000Z",
        summary: null,
      }),
      expect.objectContaining({
        subject: "evidence-binding",
        observedAt: "2026-11-02T00:00:00.000Z",
        summary: "Prefer exact source-bound evidence.",
      }),
    ]);
    await expect(learnedEntries(root, "agt_unknown0000000000000000")).rejects.toMatchObject({
      code: "agent_not_found",
    });
  });

  it("lists the paths an agent holds under a live write lease, sorted, and nothing for others", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-held-"));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "held"], io(root))).toBe(0);
    const holder = await hire(root);
    const other = await hire(root);
    const created: string[] = [];
    expect(
      await runCli(
        [
          "assignment",
          "create",
          "--type",
          "implementation",
          "--role",
          "developer",
          "--criteria",
          "Held paths are visible.",
          "--suite",
          "project.quick",
          "--path",
          "src/net",
          "--path",
          "docs",
          "--write",
          "--json",
          "--root",
          root,
        ],
        io(root, created),
      ),
    ).toBe(0);
    const { assignmentId } = JSON.parse(created.join("")) as { assignmentId: string };
    expect(
      await runCli(
        [
          "assignment",
          "claim",
          "--assignment",
          assignmentId,
          "--agent",
          holder,
          "--session",
          "ses_cli_held_01",
          "--write",
          "--json",
          "--root",
          root,
        ],
        io(root),
      ),
    ).toBe(0);
    expect(await heldPaths(root, holder)).toEqual({ paths: ["docs", "src/net"], total: 2 });
    expect(await heldPaths(root, other)).toEqual({ paths: [], total: 0 });
    // A lease that expired holds nothing.
    expect(await heldPaths(root, holder, new Date("2999-01-01T00:00:00Z"))).toEqual({
      paths: [],
      total: 0,
    });
  });

  it("reads held paths without creating the repository's workforce home", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-held-fresh-"));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "fresh"], io(root))).toBe(0);
    expect(await inspectRepositoryCoordinationHome(root)).toBeNull();
    expect(await heldPaths(root, "agt_none")).toEqual({ paths: [], total: 0 });
    expect(await inspectRepositoryCoordinationHome(root)).toBeNull();
  });

  it("unions the changed paths of the conversations an agent leads, never a joined one's", async () => {
    const folder = await mkdtemp(resolve(tmpdir(), "lervo-agent-changed-"));
    roots.push(folder);
    const launches = resolve(folder, "launches.json");
    const record = (workspaceId: string, agentId: string, access?: "read") => ({
      schemaVersion: 1 as const,
      workspaceId,
      sessionId: `ses-${workspaceId}`,
      provider: "claude",
      projectId: "prj_1",
      branch: `lervo/${workspaceId}`,
      conversationMode: "native" as const,
      argumentDigest: hash("a"),
      settingsDigest: null,
      mcpConfigDigest: null,
      preparedAt: "2026-11-27T00:00:00.000Z",
      agentId,
      ...(access === undefined ? {} : { access }),
    });
    await recordHostedLaunch(launches, record("wsp_a", "agt_ciel"));
    await recordHostedLaunch(launches, record("wsp_b", "agt_ciel"));
    await recordHostedLaunch(launches, record("wsp_c", "agt_ciel", "read"));
    const read = async (_root: string, conversationId: string) =>
      ({
        wsp_a: { paths: ["src/b.ts", "src/a.ts"], total: 4 },
        wsp_b: { paths: ["src/a.ts", "docs/x.md"], total: 2 },
        wsp_c: { paths: ["joined.ts"], total: 1 },
      })[conversationId] as never;
    // wsp_a holds two paths beyond the two it lists; wsp_c is a conversation Ciel only joined.
    expect(await changedPaths(folder, "agt_ciel", launches, read)).toEqual({
      paths: ["docs/x.md", "src/a.ts", "src/b.ts"],
      total: 5,
    });
    expect(await changedPaths(folder, "agt_arin", launches, read)).toEqual({ paths: [], total: 0 });
  });
});
