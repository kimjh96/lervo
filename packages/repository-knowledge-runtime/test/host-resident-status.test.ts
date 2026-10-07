import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireHostKnowledgeResidentLock } from "../src/host-resident-lock.js";
import {
  HOST_KNOWLEDGE_RESIDENT_STALE_MILLISECONDS,
  hostResidentScanStalled,
  parseHostKnowledgeResidentStatus,
  readHostKnowledgeResidentStatus,
  writeHostKnowledgeResidentStatus,
  type HostKnowledgeResidentStatus,
} from "../src/host-resident-status.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function directory(): Promise<string> {
  const created = await mkdtemp(resolve(tmpdir(), "lervo-host-resident-"));
  directories.push(created);
  return created;
}

const now = new Date("2026-10-06T00:00:00.000Z");
const status: HostKnowledgeResidentStatus = {
  schemaVersion: 1,
  pid: 4242,
  startedAt: "2026-10-05T23:00:00.000Z",
  heartbeatAt: "2026-10-05T23:59:30.000Z",
  launch: "service",
  role: "active",
  repositories: [
    { repositoryRoot: "/work/axli", state: "held", reason: "event_schema_outdated", detail: null },
    { repositoryRoot: "/work/lervo", state: "node_served", reason: null, detail: null },
  ],
  scan: {
    startedAt: "2026-10-05T23:55:00.000Z",
    completedAt: "2026-10-05T23:55:02.000Z",
    repositoryRoot: null,
  },
};

describe("host resident status", () => {
  it("round-trips an owner-only record and reports a live heartbeat as running", async () => {
    const path = resolve(await directory(), "state", "knowledge-host-resident.json");
    await writeHostKnowledgeResidentStatus(path, status);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readHostKnowledgeResidentStatus(path, now, () => true)).toEqual({
      status: "running",
      record: status,
    });
  });

  it("reports a dead process or an old heartbeat as stale and a missing file as absent", async () => {
    const path = resolve(await directory(), "knowledge-host-resident.json");
    expect(await readHostKnowledgeResidentStatus(path, now)).toEqual({ status: "absent" });
    await writeHostKnowledgeResidentStatus(path, status);
    expect((await readHostKnowledgeResidentStatus(path, now, () => false)).status).toBe("stale");
    const later = new Date(
      Date.parse(status.heartbeatAt) + HOST_KNOWLEDGE_RESIDENT_STALE_MILLISECONDS + 1,
    );
    expect((await readHostKnowledgeResidentStatus(path, later, () => true)).status).toBe("stale");
  });

  it("exposes a scan that keeps heartbeating but never finishes", () => {
    const stalled = {
      ...status,
      scan: {
        startedAt: "2026-10-05T23:45:00.000Z",
        completedAt: "2026-10-05T23:40:02.000Z",
        repositoryRoot: "/work/plen",
      },
    };
    expect(hostResidentScanStalled(stalled, now)).toBe(true);
    expect(hostResidentScanStalled(status, now)).toBe(false);
    expect(
      hostResidentScanStalled(
        { ...stalled, scan: { ...stalled.scan, startedAt: "2026-10-05T23:58:00.000Z" } },
        now,
      ),
    ).toBe(false);
  });

  it("rejects records that leak messages or relative paths", async () => {
    expect(
      parseHostKnowledgeResidentStatus({
        ...status,
        repositories: [{ ...status.repositories[0], reason: "Event store is old!" }],
      })?.repositories[0]?.reason,
    ).toBeNull();
    expect(
      parseHostKnowledgeResidentStatus({
        ...status,
        repositories: [{ ...status.repositories[0], repositoryRoot: "relative" }],
      }),
    ).toBeNull();
    expect(parseHostKnowledgeResidentStatus({ ...status, launch: "cron" })).toBeNull();
    const path = resolve(await directory(), "knowledge-host-resident.json");
    await writeFile(path, "not json");
    expect(await readHostKnowledgeResidentStatus(path, now)).toEqual({ status: "invalid" });
  });
});

describe("host resident lock", () => {
  it("admits one holder, keeps a second on standby, and releases only its own lock", async () => {
    const path = resolve(await directory(), "knowledge-host-resident.lock");
    const first = await acquireHostKnowledgeResidentLock(path, 100, () => true);
    expect(first.acquired).toBe(true);
    expect(await acquireHostKnowledgeResidentLock(path, 200, () => true)).toEqual({
      acquired: false,
      holderPid: 100,
    });
    if (first.acquired) await first.release();
    const second = await acquireHostKnowledgeResidentLock(path, 200, () => true);
    expect(second.acquired).toBe(true);
    if (first.acquired) await first.release();
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ schemaVersion: 1, pid: 200 });
  });

  it("replaces a lock whose holder process is gone", async () => {
    const path = resolve(await directory(), "knowledge-host-resident.lock");
    await writeFile(path, JSON.stringify({ schemaVersion: 1, pid: 100 }));
    const lock = await acquireHostKnowledgeResidentLock(path, 300, (pid) => pid !== 100);
    expect(lock.acquired).toBe(true);
    expect(JSON.parse(await readFile(path, "utf8")).pid).toBe(300);
  });
});
