import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { SQLiteConversationRepositoryWorkStore } from "../src/conversation-repository-work-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SQLiteConversationRepositoryWorkStore", () => {
  it("retains one running attempt when the same event is replayed through another handle or after reopen", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-work-store-running-"));
    roots.push(root);
    const path = resolve(root, "work.sqlite");
    const first = SQLiteConversationRepositoryWorkStore.open(path);
    let second = SQLiteConversationRepositoryWorkStore.open(path);
    const turn = {
      eventId: "evt_111111111111111111111111",
      conversationId: "cnv_example",
      threadId: null,
      workerId: "agt_111111111111111111111111",
      provider: "codex" as const,
      requestContentHash: `sha256:${"1".repeat(64)}`,
      startedAt: "2026-09-10T00:00:00.000Z",
    };
    try {
      expect(first.begin(turn).duplicate).toBeNull();
      expect(second.begin(turn).duplicate).toBe("in_progress");
      second.close();
      second = SQLiteConversationRepositoryWorkStore.open(path);
      expect(second.begin({ ...turn, startedAt: "2026-09-11T00:00:00.000Z" }).duplicate).toBe(
        "in_progress",
      );
      expect(() =>
        second.begin({ ...turn, requestContentHash: `sha256:${"2".repeat(64)}` }),
      ).toThrow("durable coordinates");
      expect(second.begin(turn).duplicate).toBe("in_progress");
      const observer = new DatabaseSync(path, { readOnly: true });
      try {
        expect(
          observer
            .prepare("SELECT status, attempt_count FROM conversation_repository_work_turns")
            .get(),
        ).toEqual({ status: "running", attempt_count: 1 });
      } finally {
        observer.close();
      }
    } finally {
      first.close();
      second.close();
    }
  });

  it("deduplicates completed work and resumes the durable conversation session", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-work-store-"));
    roots.push(root);
    const path = resolve(root, "work.sqlite");
    let store = SQLiteConversationRepositoryWorkStore.open(path);
    const turn = {
      eventId: "evt_111111111111111111111111",
      conversationId: "cnv_example",
      threadId: null,
      workerId: "agt_111111111111111111111111",
      provider: "codex" as const,
      requestContentHash: `sha256:${"1".repeat(64)}`,
      startedAt: "2026-09-10T00:00:00.000Z",
    };
    expect(store.begin(turn)).toEqual({
      providerSessionId: null,
      completed: null,
      duplicate: null,
    });
    store.complete({
      eventId: turn.eventId,
      conversationId: turn.conversationId,
      threadId: null,
      workerId: turn.workerId,
      provider: "codex",
      providerSessionId: "11111111-1111-4111-8111-111111111111",
      result: { contentHash: `sha256:${"2".repeat(64)}`, byteCount: 12 },
      completedAt: "2026-09-10T00:01:00.000Z",
    });
    store.close();
    store = SQLiteConversationRepositoryWorkStore.open(path);
    expect(store.begin(turn)).toEqual({
      providerSessionId: "11111111-1111-4111-8111-111111111111",
      completed: { contentHash: `sha256:${"2".repeat(64)}`, byteCount: 12 },
      duplicate: null,
    });
    expect(
      store.recentCompletedResults({
        conversationId: turn.conversationId,
        threadId: null,
        workerId: turn.workerId,
      }),
    ).toEqual([{ contentHash: `sha256:${"2".repeat(64)}`, byteCount: 12 }]);
    expect(
      store.begin({
        ...turn,
        eventId: "evt_222222222222222222222222",
        requestContentHash: `sha256:${"3".repeat(64)}`,
      }),
    ).toEqual({
      providerSessionId: "11111111-1111-4111-8111-111111111111",
      completed: null,
      duplicate: null,
    });
    store.fail(
      "evt_222222222222222222222222",
      "repository_observation_failed",
      "2026-09-10T00:01:30.000Z",
    );
    expect(store.failureCode("evt_222222222222222222222222")).toBe("repository_observation_failed");
    store.activateDelegate({
      conversationId: turn.conversationId,
      threadId: null,
      delegate: {
        agentId: "agt_222222222222222222222222",
        displayName: "Navi",
        roleId: "researcher",
        provider: "claude",
      },
      activatedAt: "2026-09-10T00:02:00.000Z",
    });
    expect(store.activeDelegate(turn.conversationId, null)).toEqual({
      agentId: "agt_222222222222222222222222",
      displayName: "Navi",
      roleId: "researcher",
      provider: "claude",
    });
    store.close();
  });

  it("coalesces separate events carrying the same active or recently completed request", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-work-store-duplicate-"));
    roots.push(root);
    const store = SQLiteConversationRepositoryWorkStore.open(resolve(root, "work.sqlite"));
    const turn = {
      eventId: "evt_111111111111111111111111",
      conversationId: "cnv_example",
      threadId: null,
      workerId: "agt_111111111111111111111111",
      provider: "codex" as const,
      requestContentHash: `sha256:${"1".repeat(64)}`,
      startedAt: "2026-09-10T00:00:00.000Z",
    };
    store.begin(turn);
    expect(store.begin({ ...turn, eventId: "evt_222222222222222222222222" })).toEqual({
      providerSessionId: null,
      completed: null,
      duplicate: "in_progress",
    });
    store.complete({
      eventId: turn.eventId,
      conversationId: turn.conversationId,
      threadId: null,
      workerId: turn.workerId,
      provider: "codex",
      providerSessionId: "11111111-1111-4111-8111-111111111111",
      result: { contentHash: `sha256:${"2".repeat(64)}`, byteCount: 12 },
      completedAt: "2026-09-10T00:01:00.000Z",
    });
    expect(
      store.begin({
        ...turn,
        eventId: "evt_333333333333333333333333",
        startedAt: "2026-09-10T00:02:00.000Z",
      }),
    ).toEqual({
      providerSessionId: "11111111-1111-4111-8111-111111111111",
      completed: { contentHash: `sha256:${"2".repeat(64)}`, byteCount: 12 },
      duplicate: "completed",
    });
    store.close();
  });

  it("keeps independent provider sessions for one agent and preserves replay routing", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-work-provider-sessions-"));
    roots.push(root);
    const store = SQLiteConversationRepositoryWorkStore.open(resolve(root, "work.sqlite"));
    const base = {
      conversationId: "cnv_example",
      threadId: null,
      workerId: "agt_111111111111111111111111",
      requestContentHash: `sha256:${"1".repeat(64)}`,
      startedAt: "2026-09-10T00:00:00.000Z",
    };
    const codex = { ...base, eventId: "evt_codex", provider: "codex" as const };
    const claude = {
      ...base,
      eventId: "evt_claude",
      provider: "claude" as const,
      requestContentHash: `sha256:${"2".repeat(64)}`,
    };
    try {
      expect(store.begin(codex).providerSessionId).toBeNull();
      store.complete({
        ...codex,
        providerSessionId: "codex-session",
        result: { contentHash: `sha256:${"3".repeat(64)}`, byteCount: 10 },
        completedAt: "2026-09-10T00:01:00.000Z",
      });
      expect(store.begin(claude).providerSessionId).toBeNull();
      store.complete({
        ...claude,
        providerSessionId: "claude-session",
        result: { contentHash: `sha256:${"4".repeat(64)}`, byteCount: 10 },
        completedAt: "2026-09-10T00:02:00.000Z",
      });
      expect(store.sessionProvider(base.conversationId, null, base.workerId)).toBe("claude");
      expect(store.providerForEvent(codex.eventId)).toBe("codex");
      expect(store.providerForEvent(claude.eventId)).toBe("claude");
      expect(
        store.begin({
          ...codex,
          eventId: "evt_codex_next",
          requestContentHash: `sha256:${"5".repeat(64)}`,
        }).providerSessionId,
      ).toBe("codex-session");
    } finally {
      store.close();
    }
  });

  it("migrates a legacy single-provider session without losing its opaque ID", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-work-provider-migration-"));
    roots.push(root);
    const path = resolve(root, "work.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE conversation_repository_work_sessions (
        conversation_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, thread_id, worker_id)
      ) STRICT;
      INSERT INTO conversation_repository_work_sessions VALUES
        ('cnv_example', '', 'agt_111111111111111111111111', 'codex', 'legacy-session', 1);
    `);
    legacy.close();

    const store = SQLiteConversationRepositoryWorkStore.open(path);
    try {
      expect(
        store.begin({
          eventId: "evt_after_migration",
          conversationId: "cnv_example",
          threadId: null,
          workerId: "agt_111111111111111111111111",
          provider: "codex",
          requestContentHash: `sha256:${"1".repeat(64)}`,
          startedAt: "2026-09-10T00:00:00.000Z",
        }).providerSessionId,
      ).toBe("legacy-session");
    } finally {
      store.close();
    }
  });

  it("adds bounded failure telemetry to an existing work database", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-work-store-migration-"));
    roots.push(root);
    const path = resolve(root, "work.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE conversation_repository_work_turns (
        event_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        request_content_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        provider_session_id TEXT,
        result_content_hash TEXT,
        result_byte_count INTEGER,
        started_at_ms INTEGER NOT NULL,
        completed_at_ms INTEGER
      ) STRICT;
    `);
    legacy.close();

    const store = SQLiteConversationRepositoryWorkStore.open(path);
    expect(store.failureCode("evt_missing000000000000000000")).toBeNull();
    store.close();
  });
});
