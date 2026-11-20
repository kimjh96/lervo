import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  RESIDENT_HEALTH_HEARTBEAT_MILLISECONDS,
  RESIDENT_HEALTH_STALE_MILLISECONDS,
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

it("leaves at least a 75-second blocked-loop margin under the stale bound", () => {
  expect(
    RESIDENT_HEALTH_STALE_MILLISECONDS - RESIDENT_HEALTH_HEARTBEAT_MILLISECONDS,
  ).toBeGreaterThanOrEqual(75_000);
});
