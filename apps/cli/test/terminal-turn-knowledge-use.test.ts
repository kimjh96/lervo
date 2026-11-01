import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  sha256,
} from "@lervo/repository-knowledge";
import { documentIdForPath } from "@lervo/context";
import { createTerminalCoverageReport } from "@lervo/diagnostics";
import { activateFixtureEventWriterV2 } from "../../../packages/project/test/fixture-event-writer.js";
import { runKnowledgeQuery } from "../src/knowledge-query-command.js";
import { recordKnowledgeQueryTurnSelection } from "../src/knowledge-query-turn-selection.js";
import {
  terminalEventDraft,
  unmanagedTerminalCoordinates,
} from "../src/terminal-event-coordinates.js";
import { openTerminalTurn, singleOpenTerminalTurn } from "../src/terminal-open-turns.js";
import { recordObservedTerminalTurn } from "../src/terminal-stop-observation.js";
import type { TerminalLifecycleInspection } from "../src/terminal-hook-contract.js";

const roots: string[] = [];
const projectId = "prj_turnknowledge01";
const query = "cobaltqdoc987";
const revision = sha256("unchanged repository");
beforeEach(() => {
  // These tests may run inside a Claude Code terminal, which names its own session.
  vi.stubEnv("CLAUDE_CODE_SESSION_ID", undefined);
  vi.stubEnv("CODEX_THREAD_ID", undefined);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-turn-knowledge-"));
  roots.push(root);
  await writeFile(
    resolve(root, "README.md"),
    `# Selection fixture\n\n${query} keeps terminal observations private.\n`,
  );
  await applyInitPlan(await createInitPlan({ root, projectId }));
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" }),
    new Date(),
    () => undefined,
  );
  await activateFixtureEventWriterV2({
    repositoryRoot: root,
    projectId,
    observedAt: new Date().toISOString(),
  });
  return root;
}

async function prepare(
  root: string,
  session: string,
  selectedPointers: { path: string; contentHash: string; kind: "decision" }[] = [],
  provider: "claude" | "codex" = "claude",
) {
  const coordinates = unmanagedTerminalCoordinates(provider, {
    event: "UserPromptSubmit",
    providerSessionId: session,
    providerTurnId: null,
    stopHookActive: false,
  });
  const storage = await openProjectStorage(root);
  let contextEventId: string;
  const openedAt = new Date().toISOString();
  try {
    contextEventId = storage.events.append(
      terminalEventDraft({
        projectId,
        provider,
        coordinates,
        type: "terminal.context.prepared",
        occurredAt: openedAt,
        payload: {
          observationId: "tobs_turnknowledge01",
          executionMode: "unmanaged",
          providerSessionDigest: coordinates.providerSessionDigest,
          providerTurnDigest: null,
          sourceSnapshotId: `ksnap_${"a".repeat(24)}`,
          queryDigest: sha256("query digest"),
          contextHash: sha256("compact prompt"),
          recommendationCount: 0,
          loadedDocuments: [],
          selectedPointers,
        },
      }),
    ).event.eventId;
  } finally {
    await storage.close();
  }
  const marker = {
    provider,
    providerSessionDigest: coordinates.providerSessionDigest,
    providerTurnDigest: null,
    contextEventId,
    openedAt,
  };
  await openTerminalTurn(root, marker);
  return { coordinates, marker };
}

async function queryCommand(root: string) {
  let output = "",
    error = "";
  const code = await runKnowledgeQuery(["--json", query], {
    cwd: root,
    stdout: (text) => {
      output += text;
    },
    stderr: (text) => {
      error += text;
    },
  });
  expect(error).toBe("");
  expect(code).toBe(0);
  const result = JSON.parse(output);
  expect(result.hits.length).toBeGreaterThan(0);
  return result;
}

async function events(root: string) {
  const storage = await openProjectStorage(root);
  try {
    return storage.events.list({ limit: 1000 });
  } finally {
    await storage.close();
  }
}

it("records every query result against the single open turn without query text", async () => {
  const root = await fixture();
  const { marker } = await prepare(root, "query-session");
  const result = await queryCommand(root);
  const selected = (await events(root)).filter((event) => event.type === "context.selected");
  expect(selected).toHaveLength(result.hits.length);
  result.hits.forEach((hit: { path: string; contentHash: string }, index: number) =>
    expect(selected[index]!.payload).toMatchObject({
      origin: "agent_query",
      documentId: documentIdForPath(hit.path),
      path: hit.path,
      contentHash: hit.contentHash,
      contextEventId: marker.contextEventId,
      providerSessionDigest: marker.providerSessionDigest,
      providerTurnDigest: null,
    }),
  );
  expect(JSON.stringify(selected)).not.toContain(query);
});

it.each([0, 2])("records no turn selections with %s open turns", async (count) => {
  const root = await fixture();
  for (let index = 0; index < count; index++) await prepare(root, `session-${index}`);
  await queryCommand(root);
  expect((await events(root)).filter((event) => event.type === "context.selected")).toEqual([]);
});

it("binds to the calling Claude session while other sessions have open turns", async () => {
  const root = await fixture();
  await prepare(root, "session-a");
  const { marker } = await prepare(root, "session-b");
  await prepare(root, "session-c");
  vi.stubEnv("CLAUDE_CODE_SESSION_ID", "session-b");
  const result = await queryCommand(root);
  const selected = (await events(root)).filter((event) => event.type === "context.selected");
  expect(selected).toHaveLength(result.hits.length);
  for (const event of selected)
    expect(event.payload).toMatchObject({
      origin: "agent_query",
      contextEventId: marker.contextEventId,
      providerSessionDigest: marker.providerSessionDigest,
    });
});

it("records nothing when the calling Claude session has no open turn", async () => {
  const root = await fixture();
  await prepare(root, "only-open-session");
  vi.stubEnv("CLAUDE_CODE_SESSION_ID", "session-without-turn");
  await queryCommand(root);
  expect((await events(root)).filter((event) => event.type === "context.selected")).toEqual([]);
});

it.each(["x".repeat(513), "   ", ""])(
  "never falls back to another session for an unusable Claude session: %#",
  async (session) => {
    const root = await fixture();
    await prepare(root, "unrelated-session");
    vi.stubEnv("CLAUDE_CODE_SESSION_ID", session);
    await queryCommand(root);
    expect((await events(root)).filter((event) => event.type === "context.selected")).toEqual([]);
  },
);

it("binds a Codex query to its thread, even when it inherited an outer Claude session", async () => {
  const root = await fixture();
  const { marker } = await prepare(root, "codex-thread", [], "codex");
  await prepare(root, "unrelated-session");
  vi.stubEnv("CODEX_THREAD_ID", "codex-thread");
  vi.stubEnv("CLAUDE_CODE_SESSION_ID", "outer-claude-session");
  const result = await queryCommand(root);
  const selected = (await events(root)).filter((event) => event.type === "context.selected");
  expect(selected).toHaveLength(result.hits.length);
  for (const event of selected)
    expect(event.payload).toMatchObject({
      contextEventId: marker.contextEventId,
      providerSessionDigest: marker.providerSessionDigest,
    });
});

it("binds nothing when both named provider sessions have open turns", async () => {
  const root = await fixture();
  await prepare(root, "codex-thread", [], "codex");
  await prepare(root, "claude-session");
  vi.stubEnv("CODEX_THREAD_ID", "codex-thread");
  vi.stubEnv("CLAUDE_CODE_SESSION_ID", "claude-session");
  await queryCommand(root);
  expect((await events(root)).filter((event) => event.type === "context.selected")).toEqual([]);
});

it("does not bind results when another session opens during the query", async () => {
  const root = await fixture();
  const { marker } = await prepare(root, "first-session");
  await prepare(root, "second-session");
  await recordKnowledgeQueryTurnSelection({
    root,
    turn: marker,
    hits: [
      { conceptId: `concept_${"c".repeat(24)}`, path: "README.md", contentHash: sha256("readme") },
    ],
  });
  expect((await events(root)).filter((event) => event.type === "context.selected")).toEqual([]);
});

it("keeps query output and success when selection storage fails", async () => {
  const root = await fixture();
  await prepare(root, "failure-session");
  const original = openProjectStorage;
  const storage = await original(root);
  const prototype = Object.getPrototypeOf(storage.events);
  await storage.close();
  vi.spyOn(prototype, "transact").mockImplementation(() => {
    throw new Error("selection unavailable");
  });
  await queryCommand(root);
});

it("Stop observes returned paths, deduplicates selections and closes only its own marker", async () => {
  const root = await fixture();
  const { coordinates, marker } = await prepare(root, "closing-session");
  const result = await queryCommand(root);
  const hit = result.hits[0];
  await recordKnowledgeQueryTurnSelection({ root, turn: marker, hits: [hit] });
  const other = await prepare(root, "other-session");
  const observation = await recordObservedTerminalTurn({
    root,
    provider: "claude",
    coordinates,
    hookInput: {
      event: "Stop",
      providerSessionId: "closing-session",
      providerTurnId: null,
      stopHookActive: false,
      lastAssistantMessage: `\`${hit.path}:9\` ${hit.path} docs/unselected.md`,
    },
    lifecycle: {
      status: "current",
      workspace: null,
      repositoryChange: { beforeRevision: revision, afterRevision: revision, changed: false },
    } as TerminalLifecycleInspection,
    workspaceCheckpointEventId: null,
    occurredAt: new Date().toISOString(),
  });
  expect(observation).toMatchObject({
    selectedCount: result.hits.length,
    referenceCount: 1,
    pathMentionCount: 1,
  });
  expect(await singleOpenTerminalTurn(root)).toEqual(other.marker);
  const references = (await events(root)).filter(
    (event) => event.type === "terminal.reference.observed",
  );
  expect(references).toHaveLength(1);
  expect(references[0]!.payload).toMatchObject({
    referenceKind: "path_mention",
    path: hit.path,
    contentHash: hit.contentHash,
    documentId: documentIdForPath(hit.path),
    contextEventId: marker.contextEventId,
  });
  expect(JSON.stringify(references)).not.toContain("docs/unselected.md");
});

it("counts a quoted compact pointer with zero loaded documents and labels the report proxy", async () => {
  const root = await fixture();
  const pointer = {
    path: "docs/decisions/0541-turn-use.md",
    contentHash: sha256("decision"),
    kind: "decision" as const,
  };
  const { coordinates } = await prepare(root, "compact-session", [pointer]);
  const observation = await recordObservedTerminalTurn({
    root,
    provider: "claude",
    coordinates,
    hookInput: {
      event: "Stop",
      providerSessionId: "compact-session",
      providerTurnId: null,
      stopHookActive: false,
      lastAssistantMessage: `See [decision](${pointer.path}:12).`,
    },
    lifecycle: {
      status: "current",
      workspace: null,
      repositoryChange: { beforeRevision: revision, afterRevision: revision, changed: false },
    } as TerminalLifecycleInspection,
    workspaceCheckpointEventId: null,
    occurredAt: new Date().toISOString(),
  });
  expect(observation).toMatchObject({ selectedCount: 1, referenceCount: 1, pathMentionCount: 1 });
  expect(await readdir(resolve(root, ".lervo/state/terminal-integration/open-turns"))).toEqual([]);
  const storage = await openProjectStorage(root);
  try {
    expect(
      createTerminalCoverageReport({ projectId, events: storage.events }).reports[0],
    ).toMatchObject({
      selectedCount: 1,
      referenceCount: 1,
      pathMentionCount: 1,
      documents: [],
      capabilities: { internalUse: "unsupported", explicitOutputReference: "observed" },
    });
  } finally {
    await storage.close();
  }
});
