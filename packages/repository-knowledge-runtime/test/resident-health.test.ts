import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { holdProcessPresence } from "@lervo/project-storage";
import {
  recordKnowledgeResidentHealth,
  inspectKnowledgeResidentHealth,
} from "../src/resident-health.js";

it("distinguishes an absent, active, failed and stopped resident without inferring currency", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-resident-health-"));
  try {
    expect(await inspectKnowledgeResidentHealth(root)).toMatchObject({ status: "not_running" });
    const input = { repositoryRoot: root, workerId: "resident-test" };
    await recordKnowledgeResidentHealth({ ...input, state: "running" });
    expect(await inspectKnowledgeResidentHealth(root)).toMatchObject({
      status: "healthy",
      state: "running",
    });
    await recordKnowledgeResidentHealth({
      ...input,
      state: "attention",
      reason: "knowledge_resident_cycle_failed",
    });
    expect(await inspectKnowledgeResidentHealth(root)).toMatchObject({
      status: "degraded",
      reason: "knowledge_resident_cycle_failed",
    });
    expect(
      await inspectKnowledgeResidentHealth(root, new Date(Date.now() + 120_001)),
    ).toMatchObject({ status: "not_running" });
    await recordKnowledgeResidentHealth({ ...input, state: "stopped" });
    expect(await inspectKnowledgeResidentHealth(root)).toMatchObject({ status: "not_running" });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("reuses one write handle and reopens it only when the database file changes (ADR-0599)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-resident-health-"));
  const path = resolve(root, ".lervo/state/knowledge/resident-health.sqlite");
  try {
    const input = { repositoryRoot: root, workerId: "resident-handle" };
    await recordKnowledgeResidentHealth({ ...input, state: "running" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    // A reused handle runs no mkdir, chmod or DDL, so a later heartbeat leaves the mode alone.
    await chmod(path, 0o640);
    await recordKnowledgeResidentHealth({ ...input, state: "idle" });
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    expect(await inspectKnowledgeResidentHealth(root)).toMatchObject({ state: "idle" });
    // A removed database is never written blind: the next heartbeat recreates it privately.
    await rm(path);
    await recordKnowledgeResidentHealth({ ...input, state: "waiting" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await inspectKnowledgeResidentHealth(root)).toMatchObject({ state: "waiting" });
    await recordKnowledgeResidentHealth({ ...input, state: "stopped" });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("proves a resident by its presence however old its record, and none once it is gone (ADR-0602)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-resident-health-"));
  const presence = holdProcessPresence();
  try {
    await presence.ready;
    const input = { repositoryRoot: root, workerId: "resident-presence", presence: presence.token };
    await recordKnowledgeResidentHealth({ ...input, state: "idle" });
    // A day without a write is still a running resident: nothing heartbeats.
    expect(
      await inspectKnowledgeResidentHealth(root, new Date(Date.now() + 86_400_000)),
    ).toMatchObject({ status: "healthy", state: "idle" });
    presence.release();
    await new Promise((settle) => setTimeout(settle, 50));
    expect(await inspectKnowledgeResidentHealth(root)).toMatchObject({ status: "not_running" });
  } finally {
    presence.release();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("judges a presence this host cannot probe by its writer's pid, not as gone (ADR-0602)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-resident-health-"));
  const presence = holdProcessPresence();
  try {
    await presence.ready;
    // Another namespace's token: its socket cannot be reached from here.
    const foreign = presence.token.replace(/[0-9a-f]{12}$/u, "000000000000");
    await recordKnowledgeResidentHealth({
      repositoryRoot: root,
      workerId: "resident-elsewhere",
      presence: foreign,
      state: "idle",
    });
    // Its pid lives here (it is this process), so it is kept however old its record.
    expect(
      await inspectKnowledgeResidentHealth(root, new Date(Date.now() + 86_400_000)),
    ).toMatchObject({ status: "healthy", state: "idle" });
    // Its pid is gone here too (the row is moved to an exited process): only then is it not
    // running.
    const exited = spawn(process.execPath, ["-e", ""]);
    await new Promise((settle) => exited.once("exit", settle));
    const db = new DatabaseSync(resolve(root, ".lervo/state/knowledge/resident-health.sqlite"));
    try {
      db.prepare("UPDATE residents SET pid=?").run(exited.pid!);
    } finally {
      db.close();
    }
    expect(await inspectKnowledgeResidentHealth(root)).toMatchObject({ status: "not_running" });
  } finally {
    presence.release();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("reports a live resident of an earlier release, which removes rows by heartbeat age", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-resident-health-"));
  const presence = holdProcessPresence();
  try {
    await presence.ready;
    const ours = { repositoryRoot: root, workerId: "resident-new", presence: presence.token };
    await expect(recordKnowledgeResidentHealth({ ...ours, state: "idle" })).resolves.toEqual({
      earlierWriters: false,
    });
    // An earlier release writes no presence and refreshes its heartbeat instead.
    await recordKnowledgeResidentHealth({
      repositoryRoot: root,
      workerId: "resident-old",
      state: "idle",
    });
    await expect(recordKnowledgeResidentHealth({ ...ours, state: "waiting" })).resolves.toEqual({
      earlierWriters: true,
    });
  } finally {
    presence.release();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
