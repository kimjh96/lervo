import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { operatingContractHash } from "@lervo/work-controller";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupervisionResponsibilityReader } from "../src/index.js";
import {
  hash,
  now,
  plan,
  responsibility,
} from "../../work-controller/test/operating-supervision.fixture.js";

const roots: string[] = [];
const stores: SQLiteEventStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "responsibility-reader-"));
  roots.push(root);
  const coordinates = {
    ...plan(),
    workstreamRevision: 10,
    sessionId: "ses_responsibility_fixture",
    policyVersion: hash(),
  };
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId: coordinates.projectId,
    writableEventSchemaVersion: 3,
  });
  stores.push(events);
  const artifacts = await FileSystemCas.open(resolve(root, "cas"));
  let counter = 0;
  const append = async (task = responsibility(), override: Record<string, unknown> = {}) => {
    const artifact = await artifacts.put(JSON.stringify(task, null, 2) + "\n");
    const event = events.append({
      eventId: `evt_${(++counter).toString(16).padStart(32, "0")}`,
      projectId: coordinates.projectId,
      runId: `run_${operatingContractHash({ supervisionId: coordinates.supervisionId }).slice(7, 39)}`,
      sessionId: coordinates.sessionId,
      schemaVersion: 3,
      type: "work.responsibility.bound",
      occurredAt: now,
      policyVersion: hash(),
      actor: { kind: "system" },
      payload: {
        schemaVersion: 1,
        projectId: coordinates.projectId,
        workstreamId: coordinates.workstreamId,
        workstreamRevision: 1,
        supervisionId: coordinates.supervisionId,
        ownerAgentId: coordinates.ownerAgentId,
        mandateHash: coordinates.mandateHash,
        causationEventIds: coordinates.causationEventIds,
        assignmentId: task.assignmentId,
        assignmentRevision: task.assignmentRevision,
        executorAgentId: task.executorAgentId,
        reviewerAgentId: task.reviewerAgentId,
        roleId: task.roleId,
        roleVersion: task.roleVersion,
        roleContractHash: task.roleContractHash,
        responsibilityArtifactHash: artifact.contentHash,
        predecessorBindingHash: task.predecessorBindingHash,
        ...override,
      },
    }).event;
    return { task, artifact, event };
  };
  const reader = new SupervisionResponsibilityReader(events, artifacts, coordinates, () => now);
  return { reader, append, events, artifacts, coordinates };
}

describe("canonical responsibility history", () => {
  it("loads exact CAS bytes and distinguishes their hash from the responsibility contract", async () => {
    const f = await fixture();
    const entry = await f.append();
    expect(entry.artifact.contentHash).not.toBe(operatingContractHash(entry.task));
    expect(await f.reader.current(entry.task.assignmentId)).toEqual({
      eventId: entry.event.eventId,
      responsibilityArtifactHash: entry.artifact.contentHash,
      responsibilityHash: operatingContractHash(entry.task),
      responsibility: entry.task,
    });
  });
  it("recovers the latest exact predecessor chain and returns null for an unbound assignment", async () => {
    const f = await fixture();
    expect(await f.reader.current(responsibility().assignmentId)).toBeNull();
    const first = await f.append();
    const next = {
      ...first.task,
      assignmentRevision: 2,
      predecessorBindingHash: operatingContractHash(first.task),
      taskPurpose: "Verify the next exact task.",
    };
    await f.append(next);
    expect((await f.reader.current(next.assignmentId))?.responsibility).toEqual(next);
  });
  it.each(["predecessor", "role", "owner", "mandate", "future", "revision"])(
    "rejects conflicting %s evidence",
    async (change) => {
      const f = await fixture();
      const task = responsibility();
      if (change === "predecessor") task.predecessorBindingHash = hash();
      if (change === "revision") {
        task.assignmentRevision = 2;
        await f.append(task);
        task.assignmentRevision = 1;
        task.predecessorBindingHash = operatingContractHash({
          ...task,
          assignmentRevision: 2,
          predecessorBindingHash: null,
        });
      }
      await f.append(
        task,
        change === "role"
          ? { roleContractHash: hash("b") }
          : change === "owner"
            ? { ownerAgentId: `agt_${"f".repeat(24)}` }
            : change === "mandate"
              ? { mandateHash: hash("f") }
              : change === "future"
                ? { workstreamRevision: 11 }
                : {},
      );
      await expect(f.reader.current(task.assignmentId)).rejects.toThrow();
    },
  );
  it("rejects corrupt CAS bytes and a new binding arriving during an artifact read", async () => {
    const f = await fixture();
    const first = await f.append();
    vi.spyOn(f.artifacts, "get").mockResolvedValueOnce(Buffer.from("{}"));
    await expect(f.reader.current(first.task.assignmentId)).rejects.toThrow("corrupt");
    vi.restoreAllMocks();
    const get = f.artifacts.get.bind(f.artifacts);
    vi.spyOn(f.artifacts, "get").mockImplementationOnce(async (uri) => {
      await f.append({
        ...first.task,
        assignmentRevision: 2,
        predecessorBindingHash: operatingContractHash(first.task),
      });
      return get(uri);
    });
    await expect(f.reader.current(first.task.assignmentId)).rejects.toThrow(
      "changed during observation",
    );
  });
});
