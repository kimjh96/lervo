import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
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
    await rm(root, { recursive: true, force: true });
  }
});
