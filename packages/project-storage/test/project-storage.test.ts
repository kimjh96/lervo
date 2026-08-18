import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { type OutboxStore } from "@lervo/storage-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProjectStorageOpener,
  type CloseableArtifactStore,
  openProjectStorage,
  ProjectStorageError,
} from "../src/index.js";

const projectId = "prj_01234567";
const policyVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const temporaryRoots: string[] = [];

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-project-storage-"));
  temporaryRoots.push(root);
  return root;
}

async function initializedRepository(id = projectId): Promise<string> {
  const root = await temporaryRepository();
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: id,
      now: new Date("2026-08-18T00:00:00Z"),
    }),
  );
  return root;
}

function eventDraft() {
  return {
    eventId: "evt_01234567",
    projectId,
    runId: "run_01234567",
    sessionId: "ses_01234567",
    type: "run.completed" as const,
    occurredAt: "2026-08-18T00:01:00Z",
    actor: { kind: "system" as const },
    schemaVersion: 1 as const,
    policyVersion,
    payload: {
      resultDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      artifactIds: [],
      verificationStatus: "passed",
    },
  };
}

function fakeEventStore(close: () => void): OutboxStore {
  return { close } as unknown as OutboxStore;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("project storage bootstrap", () => {
  it("opens the manifest-bound event/outbox and CAS from canonical project paths", async () => {
    const root = await initializedRepository();
    const storage = await openProjectStorage(root);

    expect(storage.manifest.projectId).toBe(projectId);
    expect(storage.manifest.dataPolicy.hubSyncEnabled).toBe(false);
    expect(storage.paths.eventDatabase).toBe(resolve(root, ".lervo/state/events.sqlite"));
    expect(storage.paths.cas).toBe(resolve(root, ".lervo/state/cas"));
    const event = storage.events.append(eventDraft()).event;
    const artifact = await storage.artifacts.put("재시작 뒤에도 읽을 원문");
    expect(storage.events.listOutbox()).toEqual([]);
    await storage.close();

    const reopened = await openProjectStorage(root);
    expect(reopened.events.get(event.eventId)).toEqual(event);
    expect(Buffer.from(await reopened.artifacts.get(artifact.uri)).toString("utf8")).toBe(
      "재시작 뒤에도 읽을 원문",
    );
    await reopened.close();
  });

  it("keeps close idempotent across current and future closeable backends", async () => {
    const root = await initializedRepository();
    const closeEvents = vi.fn();
    const closeArtifacts = vi.fn(async () => undefined);
    const open = createProjectStorageOpener({
      openEventStore: async () => fakeEventStore(closeEvents),
      openArtifactStore: async () =>
        ({ close: closeArtifacts }) as unknown as CloseableArtifactStore,
    });
    const storage = await open(root);

    await Promise.all([storage.close(), storage.close()]);
    expect(closeArtifacts).toHaveBeenCalledTimes(1);
    expect(closeEvents).toHaveBeenCalledTimes(1);
  });

  it("closes the event store when opening the artifact store fails", async () => {
    const root = await initializedRepository();
    const closeEvents = vi.fn();
    const artifactFailure = new Error("fixture artifact open failure");
    const open = createProjectStorageOpener({
      openEventStore: async () => fakeEventStore(closeEvents),
      openArtifactStore: async () => {
        throw artifactFailure;
      },
    });

    await expect(open(root)).rejects.toBe(artifactFailure);
    expect(closeEvents).toHaveBeenCalledOnce();
  });

  it("reports cleanup failure without hiding the original open failure", async () => {
    const root = await initializedRepository();
    const closeFailure = new Error("fixture close failure");
    const artifactFailure = new Error("fixture artifact open failure");
    const open = createProjectStorageOpener({
      openEventStore: async () =>
        fakeEventStore(() => {
          throw closeFailure;
        }),
      openArtifactStore: async () => {
        throw artifactFailure;
      },
    });

    const failure = await open(root).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProjectStorageError);
    expect(failure).toMatchObject({ code: "cleanup_failed" });
    const causes = (failure as ProjectStorageError).cause as AggregateError;
    expect(causes.errors[0]).toBe(artifactFailure);
    expect(causes.errors[1]).toMatchObject({
      code: "cleanup_failed",
      cause: expect.any(AggregateError),
    });
    expect(((causes.errors[1] as ProjectStorageError).cause as AggregateError).errors).toEqual([
      closeFailure,
    ]);
  });

  it("validates the manifest before opening either backend", async () => {
    const root = await initializedRepository();
    await writeFile(resolve(root, ".lervo/project.yaml"), "schemaVersion: 1\nprojectId: bad\n");
    const openEventStore = vi.fn();
    const openArtifactStore = vi.fn();
    const open = createProjectStorageOpener({ openEventStore, openArtifactStore });

    await expect(open(root)).rejects.toMatchObject({ code: "contract_invalid" });
    expect(openEventStore).not.toHaveBeenCalled();
    expect(openArtifactStore).not.toHaveBeenCalled();
  });

  it("does not open CAS when the database belongs to another project", async () => {
    const root = await initializedRepository();
    const first = await openProjectStorage(root);
    await first.close();
    const manifestPath = resolve(root, ".lervo/project.yaml");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, manifest.replace(projectId, "prj_99999999"), "utf8");
    const openArtifactStore = vi.fn();
    const open = createProjectStorageOpener({
      openEventStore: async (options) => {
        const { SQLiteEventStore } = await import("@lervo/event-store-sqlite");
        return SQLiteEventStore.open(options);
      },
      openArtifactStore,
    });

    await expect(open(root)).rejects.toMatchObject({ code: "project_mismatch" });
    expect(openArtifactStore).not.toHaveBeenCalled();
  });

  it("rejects a symbolic-link state directory before creating storage outside the project", async () => {
    const root = await initializedRepository();
    const outside = await temporaryRepository();
    await rm(resolve(root, ".lervo/state"), { recursive: true });
    await symlink(outside, resolve(root, ".lervo/state"));

    const opening = openProjectStorage(root);
    await expect(opening).rejects.toBeInstanceOf(ProjectStorageError);
    await expect(opening).rejects.toMatchObject({
      code: "storage_layout_invalid",
    });
    expect(await readdir(outside)).toEqual([]);
  });

  it("rejects an unsafe CAS path before creating the event database", async () => {
    const root = await initializedRepository();
    await writeFile(resolve(root, ".lervo/state/cas"), "user-owned file\n");

    await expect(openProjectStorage(root)).rejects.toMatchObject({
      code: "storage_layout_invalid",
    });
    await expect(readFile(resolve(root, ".lervo/state/events.sqlite"))).rejects.toThrow();
  });

  it("keeps an uninitialized repository free of storage side effects", async () => {
    const root = await temporaryRepository();

    await expect(openProjectStorage(root)).rejects.toMatchObject({ code: "not_initialized" });
    expect(await readdir(root)).toEqual([]);
  });
});
