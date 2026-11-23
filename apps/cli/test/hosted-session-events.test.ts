import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import {
  applyInitPlan,
  createInitPlan,
  loadProjectManifest,
  resolveProjectPaths,
} from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import type { HostedLaunchRecord } from "../src/hosted-launch-records.js";
import {
  appendHostedSessionEvents,
  endedEvent,
  launchedEvent,
  launchPreparedEvent,
  providerSessionDigest,
  workspaceStartedEvent,
} from "../src/hosted-session-events.js";
import { hostedEndReason } from "../src/workspace-hook-command.js";

const sessionId = "0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c";
const record: HostedLaunchRecord = {
  schemaVersion: 1,
  workspaceId: "wsp_0123456789abcdef01234567",
  sessionId,
  provider: "claude",
  projectId: "prj_hosted_events01",
  branch: "lervo/fix-the-login-form-1a2b3c",
  conversationMode: "native",
  argumentDigest: `sha256:${"a".repeat(64)}`,
  settingsDigest: `sha256:${"b".repeat(64)}`,
  mcpConfigDigest: null,
  preparedAt: "2026-11-23T09:00:00.000Z",
};

const roots: string[] = [];
const stores: SQLiteEventStore[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storage(writableEventSchemaVersion: 9 | 10) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-hosted-events-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: record.projectId }));
  const manifest = await loadProjectManifest(root);
  const events = await SQLiteEventStore.open({
    path: resolveProjectPaths(root).eventDatabase,
    projectId: manifest.projectId,
    writableEventSchemaVersion,
  });
  stores.push(events);
  return { manifest, events, writableEventSchemaVersion };
}

const all = [
  workspaceStartedEvent({
    record,
    workstreamId: "wks_0123456789abcdef01234567",
    instruction: "Fix the login form",
  }),
  launchPreparedEvent(record),
  launchedEvent(record, "2026-11-23T09:00:02.000Z"),
  endedEvent(record, "2026-11-23T09:30:00.000Z", "other", null),
];

describe("hosted session events (schema 10)", () => {
  it("records the four events once, under one session, without the session ID", async () => {
    const store = await storage(10);
    expect(appendHostedSessionEvents(store, all)).toBe("recorded");
    expect(appendHostedSessionEvents(store, all)).toBe("recorded");
    const events = store.events.list();
    expect(events.map((event) => event.type)).toEqual([
      "application.workspace.started",
      "terminal.session.launch_prepared",
      "terminal.session.launched",
      "terminal.session.ended",
    ]);
    expect(events.every((event) => event.schemaVersion === 10)).toBe(true);
    expect(new Set(events.map((event) => event.sessionId)).size).toBe(1);
    expect(JSON.stringify(events)).not.toContain(sessionId);
    expect(JSON.stringify(events)).not.toContain("Fix the login form");
    // launch_prepared and launched name the same launch.
    expect(events[1]?.payload.descriptorDigest).toBe(events[2]?.payload.descriptorDigest);
  });

  it("records each end of a resumed session, which keeps its session ID", async () => {
    const store = await storage(10);
    appendHostedSessionEvents(store, [
      endedEvent(record, "2026-11-23T09:30:00.000Z", "other", null),
      endedEvent(record, "2026-11-23T11:00:00.000Z", "other", null),
    ]);
    expect(store.events.list().map((event) => event.occurredAt)).toEqual([
      "2026-11-23T09:30:00.000Z",
      "2026-11-23T11:00:00.000Z",
    ]);
  });

  it("records nothing while the repository's writer is below schema 10", async () => {
    const store = await storage(9);
    expect(appendHostedSessionEvents(store, all)).toBe("inactive");
    expect(store.events.list()).toEqual([]);
  });

  it("names a session with the digest terminal turn events use", () => {
    expect(all[1]?.payload.providerSessionDigest).toBe(providerSessionDigest("claude", sessionId));
    expect(providerSessionDigest("codex", sessionId)).not.toBe(
      providerSessionDigest("claude", sessionId),
    );
  });

  it("records a provider's later end reasons as other", () => {
    expect(
      ["clear", "logout", "prompt_input_exit", "resume", undefined, 7].map(hostedEndReason),
    ).toEqual(["clear", "logout", "prompt_input_exit", "other", "other", "other"]);
  });
});
