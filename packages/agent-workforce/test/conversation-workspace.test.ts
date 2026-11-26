import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { RepositoryCoordinationRecords } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLAIM_PATH_KEY_FILE,
  claimPathDigest,
  conversationWorkspaceRecordId,
  createWorkspace,
  isAgentWorkspace,
  isSupersededCheckoutGeneration,
  listConversationWorkspaceGenerations,
  listWorkspaces,
  newestCheckoutWorkspace,
  readNewestCheckoutWorkspace,
  readNewestConversationWorkspace,
  readOrCreateClaimPathKey,
  recordConversationWorkspaceGeneration,
  type AgentWorkspace,
  type WorkspaceCoordinationEvent,
} from "../src/index.js";

const execute = promisify(execFile);
const roots: string[] = [];
const hash = `sha256:${"a".repeat(64)}`;
const checkout = `sha256:${"c".repeat(64)}`;
const conversationId = "wsp_0123456789abcdef01234567";

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-workspace-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_conversation_workspace",
      now: new Date("2026-11-27T00:00:00Z"),
    }),
  );
  await writeFile(resolve(root, "tracked.txt"), "base\n");
  await execute("git", ["-C", root, "init"]);
  await execute("git", ["-C", root, "config", "user.email", "lervo-test@example.invalid"]);
  await execute("git", ["-C", root, "config", "user.name", "Lervo Test"]);
  await execute("git", ["-C", root, "add", "."]);
  await execute("git", ["-C", root, "commit", "-m", "fixture"]);
  const { stdout } = await execute("git", ["-C", root, "rev-parse", "HEAD"]);
  const records = await RepositoryCoordinationRecords.open(root);
  return { root, baseCommit: stdout.trim(), records };
}

function generationInput(
  fixture: Awaited<ReturnType<typeof repository>>,
  generation: number,
  overrides: { conversationId?: string; now?: string } = {},
) {
  return {
    repositoryRoot: fixture.root,
    conversationId: overrides.conversationId ?? conversationId,
    generation,
    repositoryInstanceId: fixture.records.home.repositoryInstanceId,
    projectId: "prj_conversation_workspace",
    assignmentId: "asn_0123456789abcdef01234567",
    agentId: "agt_0123456789abcdef01234567",
    leaseGeneration: 1,
    host: { kind: "git" as const, version: "1.0.0", nativeInstanceDigest: null },
    baseCommit: fixture.baseCommit,
    integrationTargetDigest: hash,
    creationPlanId: "wpl_0123456789abcdef01234567",
    markerHash: hash,
    pathDigest: checkout,
    ownerWorkspacePath: "/workspaces/app/log-format-1a2b3c",
    inspection: { hostInspected: true, markerMatched: true, checkoutClean: true },
    now: new Date(overrides.now ?? "2026-11-27T00:01:00Z"),
  };
}

function worker(overrides: Partial<AgentWorkspace> = {}): AgentWorkspace {
  return {
    schemaVersion: 1,
    workspaceId: "wsp_aaaaaaaaaaaaaaaaaaaaaaaa",
    generation: 1,
    repositoryInstanceId: "rpi_0123456789abcdef01234567",
    projectId: "prj_conversation_workspace",
    assignmentId: "asn_0123456789abcdef01234567",
    agentId: "agt_0123456789abcdef01234567",
    leaseGeneration: 1,
    executionKind: "worker",
    host: { kind: "git", version: "1.0.0", nativeInstanceDigest: null },
    baseCommit: "a".repeat(40),
    integrationTargetDigest: hash,
    creationPlanId: "wpl_0123456789abcdef01234567",
    markerHash: hash,
    pathDigest: checkout,
    state: "ready",
    writerSession: null,
    sealedResult: null,
    integrationQueueEntryId: null,
    integrationEvidenceId: null,
    cleanupPlanId: null,
    recoveryReason: null,
    revision: 2,
    createdAt: "2026-11-27T00:00:00Z",
    updatedAt: "2026-11-27T00:00:00Z",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conversation workspace records", () => {
  it("derive one record ID per generation of a conversation", () => {
    const first = conversationWorkspaceRecordId(conversationId, 1);
    expect(first).toMatch(/^wsp_[a-f0-9]{24}$/u);
    expect(conversationWorkspaceRecordId(conversationId, 1)).toBe(first);
    expect(conversationWorkspaceRecordId(conversationId, 2)).not.toBe(first);
    expect(conversationWorkspaceRecordId("wsp_1123456789abcdef01234567", 1)).not.toBe(first);
    expect(() => conversationWorkspaceRecordId(conversationId, 0)).toThrow(TypeError);
    expect(() => conversationWorkspaceRecordId("conversation", 1)).toThrow(TypeError);
  });

  it("are valid only when their kind fields agree", () => {
    const workspaceId = conversationWorkspaceRecordId(conversationId, 1);
    const conversation = worker({ workspaceId, kind: "conversation", conversationId });
    expect(isAgentWorkspace(conversation)).toBe(true);
    expect(isAgentWorkspace(worker())).toBe(true);
    expect(isAgentWorkspace(worker({ kind: "worker" }))).toBe(true);
    expect(isAgentWorkspace({ ...conversation, generation: 2 })).toBe(false);
    const { conversationId: _omitted, ...unnamed } = conversation;
    expect(isAgentWorkspace(unnamed)).toBe(false);
    expect(isAgentWorkspace({ ...conversation, executionKind: "integrator" })).toBe(false);
    expect(isAgentWorkspace(worker({ conversationId }))).toBe(false);
  });

  it("let the newest live generation speak for the checkout", () => {
    const first = worker({
      workspaceId: conversationWorkspaceRecordId(conversationId, 1),
      kind: "conversation",
      conversationId,
      state: "integration_pending",
    });
    const second = worker({
      workspaceId: conversationWorkspaceRecordId(conversationId, 2),
      generation: 2,
      kind: "conversation",
      conversationId,
      state: "active",
      createdAt: "2026-11-27T01:00:00Z",
    });
    expect(newestCheckoutWorkspace([second, first], checkout)).toBe(second);
    expect(isSupersededCheckoutGeneration(first, [first, second])).toBe(true);
    expect(isSupersededCheckoutGeneration(second, [first, second])).toBe(false);
    // A removed generation never speaks for the checkout.
    const removed = { ...second, state: "removed" as const };
    expect(newestCheckoutWorkspace([first, removed], checkout)).toBe(first);
    expect(isSupersededCheckoutGeneration(first, [first, removed])).toBe(false);
    expect(newestCheckoutWorkspace([first], `sha256:${"d".repeat(64)}`)).toBeNull();
    // A worker's single record is the newest of its checkout, as before.
    expect(newestCheckoutWorkspace([worker()], checkout)?.kind).toBeUndefined();
  });

  it("record a generation as ready and read it by checkout and by conversation", async () => {
    const fixture = await repository();
    const ready = await recordConversationWorkspaceGeneration(generationInput(fixture, 1));
    expect(ready.workspace).toMatchObject({
      workspaceId: conversationWorkspaceRecordId(conversationId, 1),
      kind: "conversation",
      conversationId,
      generation: 1,
      state: "ready",
      revision: 2,
      ownerWorkspacePath: "/workspaces/app/log-format-1a2b3c",
    });
    expect(await readNewestCheckoutWorkspace(fixture.root, checkout)).toEqual(ready.workspace);
    expect(await readNewestConversationWorkspace(fixture.root, conversationId)).toEqual(
      ready.workspace,
    );
    expect(await listConversationWorkspaceGenerations(fixture.root, conversationId)).toEqual([
      ready.workspace,
    ]);
    expect(
      await readNewestConversationWorkspace(fixture.root, "wsp_1123456789abcdef01234567"),
    ).toBe(null);
    const events = (await fixture.records.list<WorkspaceCoordinationEvent>("events")).map(
      (item) => item.value,
    );
    expect(events.map((event) => [event.type, event.state])).toEqual(
      expect.arrayContaining([
        ["agent.workspace.provisioned", "provisioning"],
        ["agent.workspace.state.changed", "ready"],
      ]),
    );

    // The next generation of the same checkout shares its path digest and becomes the newest.
    const next = await recordConversationWorkspaceGeneration(
      generationInput(fixture, 2, { now: "2026-11-27T00:02:00Z" }),
    );
    expect(await readNewestCheckoutWorkspace(fixture.root, checkout)).toEqual(next.workspace);
    expect(
      (await listConversationWorkspaceGenerations(fixture.root, conversationId)).map(
        (workspace) => workspace.generation,
      ),
    ).toEqual([1, 2]);
  });

  it("refuse a generation when another record speaks for the checkout", async () => {
    const fixture = await repository();
    await recordConversationWorkspaceGeneration(generationInput(fixture, 1));
    await expect(
      recordConversationWorkspaceGeneration(
        generationInput(fixture, 1, { conversationId: "wsp_1123456789abcdef01234567" }),
      ),
    ).rejects.toMatchObject({ code: "workspace_transition_conflict" });
    await expect(
      recordConversationWorkspaceGeneration(generationInput(fixture, 1)),
    ).rejects.toMatchObject({
      code: "workspace_transition_conflict",
    });
    expect(await listWorkspaces(fixture.root)).toHaveLength(1);
  });

  it("refuse ready without the host's proof and leave the record provisioning", async () => {
    const fixture = await repository();
    await expect(
      recordConversationWorkspaceGeneration({
        ...generationInput(fixture, 1),
        inspection: { hostInspected: true, markerMatched: false, checkoutClean: true },
      }),
    ).rejects.toMatchObject({ code: "workspace_transition_conflict" });
    expect((await listWorkspaces(fixture.root)).map((workspace) => workspace.state)).toEqual([
      "provisioning",
    ]);
  });

  it("keep a worker record readable beside a conversation record", async () => {
    const fixture = await repository();
    const record = worker({
      repositoryInstanceId: fixture.records.home.repositoryInstanceId,
      state: "provisioning",
      revision: 1,
      pathDigest: `sha256:${"e".repeat(64)}`,
    });
    await createWorkspace({
      repositoryRoot: fixture.root,
      workspace: record,
      eventId: "evt_worker_00000001",
    });
    await recordConversationWorkspaceGeneration(generationInput(fixture, 1));
    expect(await readNewestCheckoutWorkspace(fixture.root, record.pathDigest)).toEqual(record);
  });
});

describe("the claim path key", () => {
  it("is created once, owner-only, beside the coordination records, and then reused", async () => {
    const fixture = await repository();
    const key = await readOrCreateClaimPathKey(fixture.root);
    expect(key.byteLength).toBe(32);
    const path = resolve(fixture.records.home.root, CLAIM_PATH_KEY_FILE);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readOrCreateClaimPathKey(fixture.root)).toEqual(key);
    expect(claimPathDigest(key, "src/a.ts")).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
  });

  it("agrees on one key when first uses race", async () => {
    const fixture = await repository();
    let calls = 0;
    const generate = () => new Uint8Array(32).fill(++calls);
    const keys = await Promise.all(
      [1, 2, 3].map(() => readOrCreateClaimPathKey(fixture.root, { generate })),
    );
    expect(keys[1]).toEqual(keys[0]);
    expect(keys[2]).toEqual(keys[0]);
  });

  it("fails closed on a key that is not owner-only or not 32 bytes", async () => {
    const fixture = await repository();
    await readOrCreateClaimPathKey(fixture.root);
    const path = resolve(fixture.records.home.root, CLAIM_PATH_KEY_FILE);
    await chmod(path, 0o644);
    await expect(readOrCreateClaimPathKey(fixture.root)).rejects.toMatchObject({
      code: "workforce_state_invalid",
    });
    await rm(path);
    await writeFile(path, "short", { mode: 0o600 });
    await expect(readOrCreateClaimPathKey(fixture.root)).rejects.toMatchObject({
      code: "workforce_state_invalid",
    });
  });
});
