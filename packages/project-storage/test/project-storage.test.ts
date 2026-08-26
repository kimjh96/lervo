import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { type OutboxStore } from "@lervo/storage-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProjectStorageOpener,
  type CloseableArtifactStore,
  openProjectStorage,
  ProjectStorageError,
  resolveRepositoryCoordinationHome,
} from "../src/index.js";

const projectId = "prj_01234567";
const policyVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const temporaryRoots: string[] = [];
const execute = promisify(execFile);

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
      resultDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      artifactIds: ["art_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      verificationStatus: "not_run",
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
  it("resolves one owner-only coordination home for sibling Git worktrees", async () => {
    const root = await initializedRepository();
    await writeFile(resolve(root, "tracked.txt"), "base\n");
    await execute("git", ["-C", root, "init"]);
    await execute("git", ["-C", root, "config", "user.email", "lervo-test@example.invalid"]);
    await execute("git", ["-C", root, "config", "user.name", "Lervo Test"]);
    await execute("git", ["-C", root, "add", "."]);
    await execute("git", ["-C", root, "commit", "-m", "fixture"]);
    const sibling = await temporaryRepository();
    await rm(sibling, { recursive: true });
    await execute("git", ["-C", root, "worktree", "add", "--detach", sibling, "HEAD"]);

    const [first, second] = await Promise.all([
      resolveRepositoryCoordinationHome(root, { now: new Date("2026-08-26T00:00:00Z") }),
      resolveRepositoryCoordinationHome(sibling, { now: new Date("2026-08-26T00:00:01Z") }),
    ]);

    expect(first).toMatchObject({
      schemaVersion: 1,
      storageKind: "git_common_directory",
      repositoryInstanceId: expect.stringMatching(/^rpi_[a-f0-9]{24}$/u),
    });
    expect(second.repositoryInstanceId).toBe(first.repositoryInstanceId);
    expect(second.root).toBe(first.root);
    expect(second.workforce).toBe(first.workforce);
  });

  it("rejects two non-empty workforce authorities during sibling migration", async () => {
    const root = await initializedRepository();
    await writeFile(resolve(root, "tracked.txt"), "base\n");
    await execute("git", ["-C", root, "init"]);
    await execute("git", ["-C", root, "config", "user.email", "lervo-test@example.invalid"]);
    await execute("git", ["-C", root, "config", "user.name", "Lervo Test"]);
    await execute("git", ["-C", root, "add", "."]);
    await execute("git", ["-C", root, "commit", "-m", "fixture"]);
    const sibling = await temporaryRepository();
    await rm(sibling, { recursive: true });
    await execute("git", ["-C", root, "worktree", "add", "--detach", sibling, "HEAD"]);
    await mkdir(resolve(root, ".lervo/data/workforce"), { recursive: true });
    await mkdir(resolve(sibling, ".lervo/data/workforce"), { recursive: true });
    await writeFile(resolve(root, ".lervo/data/workforce/agents.json"), "root authority\n");
    await writeFile(resolve(sibling, ".lervo/data/workforce/agents.json"), "sibling authority\n");

    await resolveRepositoryCoordinationHome(root);
    await expect(resolveRepositoryCoordinationHome(sibling)).rejects.toMatchObject({
      code: "coordination_migration_conflict",
    });
  });

  it("opens the manifest-bound event/outbox and CAS from canonical project paths", async () => {
    const root = await initializedRepository();
    const storage = await openProjectStorage(root);

    expect(storage.manifest.projectId).toBe(projectId);
    expect(storage.manifest.dataPolicy.hubSyncEnabled).toBe(false);
    expect(storage.paths.eventDatabase).toBe(resolve(root, ".lervo/data/events.sqlite"));
    expect(storage.paths.cas).toBe(resolve(root, ".lervo/data/cas"));
    const event = storage.events.append(eventDraft()).event;
    const artifact = await storage.artifacts.put("source text readable after restart");
    expect(storage.events.listOutbox()).toEqual([]);
    await storage.close();

    const reopened = await openProjectStorage(root);
    expect(reopened.events.get(event.eventId)).toEqual(event);
    expect(Buffer.from(await reopened.artifacts.get(artifact.uri)).toString("utf8")).toBe(
      "source text readable after restart",
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
    await rm(resolve(root, ".lervo/state"), { recursive: true, force: true });
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
    await mkdir(resolve(root, ".lervo/data"));
    await writeFile(resolve(root, ".lervo/data/cas"), "user-owned file\n");

    await expect(openProjectStorage(root)).rejects.toMatchObject({
      code: "storage_layout_invalid",
    });
    await expect(readFile(resolve(root, ".lervo/data/events.sqlite"))).rejects.toThrow();
  });

  it("migrates durable legacy records out of deletable state without data loss", async () => {
    const root = await initializedRepository();
    const first = await openProjectStorage(root);
    const event = first.events.append(eventDraft()).event;
    const artifact = await first.artifacts.put("legacy durable bytes");
    await first.close();

    await rename(
      resolve(root, ".lervo/data/events.sqlite"),
      resolve(root, ".lervo/state/events.sqlite"),
    );
    await rename(resolve(root, ".lervo/data/cas"), resolve(root, ".lervo/state/cas"));

    const migrated = await openProjectStorage(root);
    expect(migrated.events.get(event.eventId)).toEqual(event);
    expect(Buffer.from(await migrated.artifacts.get(artifact.uri)).toString("utf8")).toBe(
      "legacy durable bytes",
    );
    await migrated.close();
    await expect(lstat(resolve(root, ".lervo/state/events.sqlite"))).rejects.toThrow();
    await expect(lstat(resolve(root, ".lervo/state/cas"))).rejects.toThrow();
  });

  it("migrates legacy Node policy and replay databases out of deletable state", async () => {
    const root = await initializedRepository();
    const state = resolve(root, ".lervo/state");
    const data = resolve(root, ".lervo/data");
    const entries = [
      "policy.sqlite",
      "policy.sqlite-wal",
      "policy.sqlite-shm",
      "remote-command-replay.sqlite",
      "remote-command-replay.sqlite-wal",
      "remote-command-replay.sqlite-shm",
    ];
    await mkdir(state, { recursive: true });
    await Promise.all(entries.map((name) => writeFile(resolve(state, name), `legacy ${name}\n`)));

    const storage = await openProjectStorage(root);
    await storage.close();

    for (const name of entries) {
      expect(await readFile(resolve(data, name), "utf8")).toBe(`legacy ${name}\n`);
      await expect(lstat(resolve(state, name))).rejects.toThrow();
    }
  });

  it("refuses conflicting durable and legacy copies", async () => {
    const root = await initializedRepository();
    await Promise.all([
      mkdir(resolve(root, ".lervo/state"), { recursive: true }),
      mkdir(resolve(root, ".lervo/data"), { recursive: true }),
    ]);
    await writeFile(resolve(root, ".lervo/state/events.sqlite"), "legacy");
    await writeFile(resolve(root, ".lervo/data/events.sqlite"), "current");

    await expect(openProjectStorage(root)).rejects.toMatchObject({
      code: "storage_layout_invalid",
    });
  });

  it("removes verified empty legacy copies recreated by a completed old runtime", async () => {
    const root = await initializedRepository();
    const current = await openProjectStorage(root);
    current.events.append(eventDraft());
    await current.artifacts.put("durable object");
    await current.close();

    const { SQLiteEventStore } = await import("@lervo/event-store-sqlite");
    const legacy = await SQLiteEventStore.open({
      path: resolve(root, ".lervo/state/events.sqlite"),
      projectId,
    });
    legacy.close();
    await mkdir(resolve(root, ".lervo/state/cas/sha256"), { recursive: true });
    await mkdir(resolve(root, ".lervo/state/cas/.tmp"), { recursive: true });

    const reopened = await openProjectStorage(root);
    expect(reopened.events.list()).toHaveLength(1);
    await reopened.close();
    await expect(lstat(resolve(root, ".lervo/state/events.sqlite"))).rejects.toThrow();
    await expect(lstat(resolve(root, ".lervo/state/cas"))).rejects.toThrow();
  });

  it("keeps an uninitialized repository free of storage side effects", async () => {
    const root = await temporaryRepository();

    await expect(openProjectStorage(root)).rejects.toMatchObject({ code: "not_initialized" });
    expect(await readdir(root)).toEqual([]);
  });
});
