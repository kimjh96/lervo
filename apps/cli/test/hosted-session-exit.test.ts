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
import { appendHostedSessionEvents, endedEvent } from "../src/hosted-session-events.js";
import { appendProcessExit } from "../src/hosted-session-exit.js";

const record: HostedLaunchRecord = {
  schemaVersion: 1,
  workspaceId: "wsp_0123456789abcdef01234567",
  sessionId: "0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c",
  provider: "claude",
  projectId: "prj_hosted_exit0001",
  branch: "lervo/fix-the-login-form-1a2b3c",
  conversationMode: "native",
  argumentDigest: `sha256:${"a".repeat(64)}`,
  settingsDigest: `sha256:${"b".repeat(64)}`,
  mcpConfigDigest: null,
  preparedAt: "2026-11-23T10:00:00.000Z",
};

const roots: string[] = [];
const stores: SQLiteEventStore[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storage(writableEventSchemaVersion: 9 | 10) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-hosted-exit-"));
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

function ends(store: Awaited<ReturnType<typeof storage>>) {
  return store.events
    .list({ types: ["terminal.session.ended"] })
    .map((event) => [event.payload.endReason, event.payload.exitCode]);
}

describe("the session host's exit report", () => {
  it("records process_exited with the code when no hook recorded the launch's end", async () => {
    const store = await storage(10);
    expect(appendProcessExit(store, record, 137, "2026-11-23T10:05:00.000Z")).toBe("recorded");
    expect(ends(store)).toEqual([["process_exited", 137]]);
  });

  it("skips a launch whose SessionEnd hook already recorded the end", async () => {
    const store = await storage(10);
    appendHostedSessionEvents(store, [
      endedEvent(record, "2026-11-23T10:04:59.000Z", "other", null),
    ]);
    expect(appendProcessExit(store, record, 0, "2026-11-23T10:05:00.000Z")).toBe("skipped");
    expect(ends(store)).toEqual([["other", null]]);
  });

  it("does not count an end from the session's earlier launch", async () => {
    const store = await storage(10);
    appendHostedSessionEvents(store, [
      endedEvent(record, "2026-11-23T09:30:00.000Z", "other", null),
    ]);
    expect(appendProcessExit(store, record, null, "2026-11-23T10:05:00.000Z")).toBe("recorded");
    expect(ends(store)).toEqual([
      ["other", null],
      ["process_exited", null],
    ]);
  });

  it("records nothing below schema 10", async () => {
    const store = await storage(9);
    expect(appendProcessExit(store, record, 1, "2026-11-23T10:05:00.000Z")).toBe("inactive");
  });
});
