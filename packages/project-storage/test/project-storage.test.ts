import * as projectCoordinates from "@lervo/project";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  applyEventWriterActivationPlan,
  applyInitPlan,
  createInitPlan,
  planEventWriterActivation,
  planEventWriterRollback,
} from "@lervo/project";
import { createEventReaderCapabilities } from "@lervo/event-contract";
import { type OutboxStore } from "@lervo/storage-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProjectStorageOpener,
  type CloseableArtifactStore,
  openProjectStorage,
  openReadOnlyProjectStorage,
  ProjectStorageError,
  resolveRepositoryCoordinationHome,
} from "../src/index.js";

const projectId = "prj_01234567";
const policyVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const temporaryRoots: string[] = [];
const execute = promisify(execFile);

it("observes a live peer store while rejecting event and artifact writes", async () => {
  const root = await initializedRepository();
  const owner = await openProjectStorage(root);
  const stored = await owner.artifacts.put("scoped handoff evidence");
  owner.events.append(eventDraft());
  const reader = await openReadOnlyProjectStorage(root);
  try {
    expect(reader.readOnly).toBe(true);
    expect(await reader.artifacts.get(stored.uri)).toEqual(await owner.artifacts.get(stored.uri));
    expect(reader.events.latest()).toEqual(owner.events.latest());
    expect(() =>
      reader.events.append({ ...eventDraft(), eventId: "evt_foreign_write_001" }),
    ).toThrow(expect.objectContaining({ code: "read_only" }));
    await expect(reader.artifacts.put("foreign write")).rejects.toMatchObject({
      code: "read_only",
    });
    owner.events.append({ ...eventDraft(), eventId: "evt_second_owner_001" });
    expect(reader.events.latest()?.eventId).toBe("evt_second_owner_001");
  } finally {
    await reader.close();
    await owner.close();
  }
});

it("does not initialize or migrate absent peer stores", async () => {
  const root = await initializedRepository();
  const before = await readdir(resolve(root, ".lervo"), { recursive: true });
  await expect(openReadOnlyProjectStorage(root)).rejects.toThrow();
  expect(await readdir(resolve(root, ".lervo"), { recursive: true })).toEqual(before);
});

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
  it("reopens a mixed version 1/2/3 chain after explicit activation and writer rollback", async () => {
    const id = `prj_${"a".repeat(16)}`;
    const root = await initializedRepository(id);
    const evidence = {
      schemaVersion: 1,
      projectId: id,
      observedAt: "2026-09-11T00:00:00.000Z",
      readers: [
        {
          readerId: "reader_local_runtime",
          readerKind: "local",
          peerIdentityHash: null,
          capabilities: createEventReaderCapabilities(),
        },
      ],
    };
    const activation = await planEventWriterActivation({
      repositoryRoot: root,
      evidence,
      targetEventSchemaVersion: 3,
    });
    await applyEventWriterActivationPlan({
      plan: activation,
      approval: activation.planId,
      currentEvidence: evidence,
    });
    const draft = {
      eventId: `evt_${"c".repeat(32)}`,
      projectId: id,
      runId: "run_supervision_fixture",
      sessionId: "ses_supervision_fixture",
      type: "work.supervision.bound" as const,
      schemaVersion: 3 as const,
      occurredAt: "2026-09-11T00:00:00.000Z",
      policyVersion,
      actor: { kind: "system" as const },
      payload: {
        schemaVersion: 1,
        projectId: id,
        workstreamId: `wks_${"a".repeat(24)}`,
        workstreamRevision: 1,
        supervisionId: "supervision.fixture",
        ownerAgentId: `agt_${"a".repeat(24)}`,
        mandateHash: policyVersion,
        causationEventIds: [],
        requestArtifactHash: policyVersion,
        acceptanceArtifactHash: policyVersion,
        expectedGraphHash: policyVersion,
      },
    };
    const storage = await openProjectStorage(root);
    let hashes: string[];
    try {
      expect(storage.writableEventSchemaVersion).toBe(3);
      storage.events.append({ ...eventDraft(), projectId: id, eventId: `evt_${"a".repeat(32)}` });
      storage.events.append({
        ...eventDraft(),
        projectId: id,
        eventId: `evt_${"b".repeat(32)}`,
        schemaVersion: 2,
      });
      storage.events.append(draft);
      const history = storage.events.list({ limit: 100 });
      expect(history.map((event) => event.schemaVersion)).toEqual([1, 2, 3]);
      hashes = history.map((event) => event.eventHash);
    } finally {
      await storage.close();
    }
    const rollback = await planEventWriterRollback(root);
    await applyEventWriterActivationPlan({ plan: rollback, approval: rollback.planId });
    const reopened = await openProjectStorage(root);
    try {
      expect(reopened.writableEventSchemaVersion).toBe(1);
      expect(reopened.events.list({ limit: 100 }).map((event) => event.eventHash)).toEqual(hashes!);
      expect(reopened.events.verifyIntegrity().valid).toBe(true);
      expect(() =>
        reopened.events.append({ ...draft, eventId: `evt_${"d".repeat(32)}` }),
      ).toThrowError(expect.objectContaining({ code: "event_schema_unsupported" }));
    } finally {
      await reopened.close();
    }
  });
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
    expect(await resolveRepositoryCoordinationHome(sibling, { readOnly: true })).toEqual(second);
  });

  it("recovers an expired initialization lock whose owner process has exited", async () => {
    const root = await initializedRepository();
    const home = await resolveRepositoryCoordinationHome(root);
    const lock = resolve(home.root, ".initializing.lock");
    await writeFile(
      lock,
      `${JSON.stringify({
        schemaVersion: 1,
        processId: 2_147_483_647,
        createdAt: "2000-01-01T00:00:00.000Z",
      })}\n`,
      { mode: 0o600 },
    );
    await utimes(lock, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));

    await expect(resolveRepositoryCoordinationHome(root)).resolves.toMatchObject({
      root: home.root,
      repositoryInstanceId: home.repositoryInstanceId,
    });
    await expect(lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("waits for a live peer to finish a multi-second coordination initialization", async () => {
    const root = await initializedRepository();
    const home = await resolveRepositoryCoordinationHome(root);
    const lock = resolve(home.root, ".initializing.lock");
    await writeFile(
      lock,
      `${JSON.stringify({ schemaVersion: 1, processId: process.pid, createdAt: new Date().toISOString() })}\n`,
      { mode: 0o600 },
    );

    const release = new Promise<void>((resolveRelease, rejectRelease) => {
      setTimeout(() => {
        rm(lock, { force: true }).then(resolveRelease, rejectRelease);
      }, 2_300);
    });
    const reopened = expect(resolveRepositoryCoordinationHome(root)).resolves.toMatchObject({
      root: home.root,
      repositoryInstanceId: home.repositoryInstanceId,
    });
    await Promise.all([release, reopened]);
  }, 15_000);

  it("fails closed for an invalid initialization lock", async () => {
    const root = await initializedRepository();
    const home = await resolveRepositoryCoordinationHome(root);
    const lock = resolve(home.root, ".initializing.lock");
    await writeFile(lock, "not-json\n", { mode: 0o600 });
    await utimes(lock, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));

    await expect(resolveRepositoryCoordinationHome(root)).rejects.toMatchObject({
      code: "coordination_home_invalid",
    });
  });

  it("rejects a manifest nested below the observed Git root", async () => {
    const root = await initializedRepository();
    await execute("git", ["-C", root, "init"]);
    const nested = resolve(root, "nested");
    await mkdir(nested);
    await applyInitPlan(await createInitPlan({ root: nested, projectId }));
    await expect(resolveRepositoryCoordinationHome(nested)).rejects.toMatchObject({
      code: "coordination_home_invalid",
    });
  });

  it.skipIf(process.platform === "win32")(
    "rejects ambiguous multiline Git coordinates",
    async () => {
      const root = await initializedRepository();
      const renamed = `${root}\nambiguous`;
      await rename(root, renamed);
      temporaryRoots.push(renamed);
      await execute("git", ["-C", renamed, "init"]);
      await expect(resolveRepositoryCoordinationHome(renamed)).rejects.toMatchObject({
        code: "coordination_home_invalid",
      });
    },
  );

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

  it("passes the managed writer selection to the event-store adapter", async () => {
    const root = await initializedRepository();
    const plan = await planEventWriterActivation({
      repositoryRoot: root,
      evidence: {
        schemaVersion: 1,
        projectId,
        observedAt: "2026-09-01T00:00:00.000Z",
        readers: [
          {
            readerId: "reader_local001",
            readerKind: "local",
            peerIdentityHash: null,
            capabilities: {
              schemaVersion: 1,
              capability: "event_reader",
              readableEventSchemaVersions: [1, 2],
            },
          },
        ],
      },
    });
    await applyEventWriterActivationPlan({ plan, approval: plan.planId });
    const openEventStore = vi.fn(async () => fakeEventStore(() => undefined));
    const open = createProjectStorageOpener({
      openEventStore,
      openArtifactStore: async () => ({}) as CloseableArtifactStore,
    });

    const storage = await open(root);
    expect(openEventStore).toHaveBeenCalledWith({
      path: resolve(root, ".lervo/data/events.sqlite"),
      projectId,
      writableEventSchemaVersion: 2,
    });
    await storage.close();
  });

  it("emits version 2 envelopes from existing common event drafts after activation", async () => {
    const root = await initializedRepository();
    const plan = await planEventWriterActivation({
      repositoryRoot: root,
      evidence: {
        schemaVersion: 1,
        projectId,
        observedAt: "2026-09-01T00:00:00.000Z",
        readers: [
          {
            readerId: "reader_local001",
            readerKind: "local",
            peerIdentityHash: null,
            capabilities: {
              schemaVersion: 1,
              capability: "event_reader",
              readableEventSchemaVersions: [1, 2],
            },
          },
        ],
      },
    });
    await applyEventWriterActivationPlan({ plan, approval: plan.planId });

    const storage = await openProjectStorage(root);
    const appended = storage.events.append(eventDraft());
    expect(appended.event.schemaVersion).toBe(2);
    expect(storage.events.append(eventDraft())).toMatchObject({
      inserted: false,
      event: appended.event,
    });
    await storage.close();
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

it("rejects project replacement between opening preparation and fresh coordinates before backend effects", async () => {
  const root = await initializedRepository();
  const inspect = projectCoordinates.inspectProjectStorageCoordinates;
  const observation = vi
    .spyOn(projectCoordinates, "inspectProjectStorageCoordinates")
    .mockImplementationOnce(async (path) => {
      const manifestPath = resolve(path, ".lervo/project.yaml");
      await writeFile(
        manifestPath,
        (await readFile(manifestPath, "utf8")).replace(projectId, "prj_replaced_project"),
      );
      return inspect(path);
    });
  const openEventStore = vi.fn(async () => {
    throw new Error("backend must not open");
  });
  const openArtifactStore = vi.fn(async () => {
    throw new Error("backend must not open");
  });
  try {
    const open = createProjectStorageOpener({ openEventStore, openArtifactStore });
    await expect(open(root)).rejects.toMatchObject({ code: "storage_binding_changed" });
    expect(openEventStore).not.toHaveBeenCalled();
    expect(openArtifactStore).not.toHaveBeenCalled();
  } finally {
    observation.mockRestore();
  }
});
