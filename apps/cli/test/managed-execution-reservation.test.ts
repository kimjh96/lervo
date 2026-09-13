import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { operatingContractHash } from "@lervo/work-controller";
import { activateFixtureEventWriterV3 } from "../../../packages/project/test/fixture-event-writer.js";
import { reserveManagedExecution } from "../src/managed-execution-reservation.js";
import type { ManagedRunRequest } from "../src/managed-run.js";

const roots: string[] = [];
const stores: ProjectStorage[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps a crashed prelude reserved across stale connections and reopening without storing its body", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-reservation-"));
  roots.push(root);
  const projectId = "prj_reservation_test";
  await applyInitPlan(await createInitPlan({ root, projectId, now: new Date() }));
  await activateFixtureEventWriterV3({
    repositoryRoot: root,
    projectId,
    observedAt: new Date().toISOString(),
  });
  const first = await openProjectStorage(root);
  const second = await openProjectStorage(root);
  stores.push(first, second);
  const request: ManagedRunRequest = {
    repositoryRoot: root,
    executionKey: operatingContractHash("one attempt"),
    provider: "codex",
    instructions: "Private task body must stay out of the event log.",
    risk: "low",
    expectedPaths: ["src/result.ts"],
    verificationSuiteIds: ["project.check"],
  };
  const identity = reserveManagedExecution(first, request, new Date())!;
  expect(() => reserveManagedExecution(second, request, new Date())).toThrow(/already reserved/);
  const reopened = await openProjectStorage(root);
  stores.push(reopened);
  expect(() =>
    reserveManagedExecution(reopened, { ...request, instructions: "changed" }, new Date()),
  ).toThrow(/already reserved/);
  const event = reopened.events.latest()!;
  expect(event.runId).toBe(identity.runId);
  expect(event.type).toBe("managed.execution.reserved");
  expect(Object.keys(event.payload).sort()).toEqual(["executionKey", "requestHash"]);
  expect(JSON.stringify(event)).not.toContain(request.instructions);
});

it("rejects keyed invocation on an unreviewed writer before recording anything", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-reservation-writer-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({ root, projectId: "prj_reservation_writer", now: new Date() }),
  );
  const storage = await openProjectStorage(root);
  stores.push(storage);
  const before = storage.events.latest();
  expect(() =>
    reserveManagedExecution(
      storage,
      {
        repositoryRoot: root,
        executionKey: operatingContractHash("attempt"),
        provider: "codex",
        instructions: "Inspect src/result.ts",
        risk: "low",
        expectedPaths: ["src/result.ts"],
        verificationSuiteIds: ["project.check"],
      },
      new Date(),
    ),
  ).toThrow(/writer version 3/);
  expect(storage.events.latest()).toEqual(before);
});
