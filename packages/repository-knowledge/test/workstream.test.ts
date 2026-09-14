import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyHandoffWorkstreamMigrationPlan,
  applyReplicatedWorkstreamImportPlan,
  applyWorkstreamStartPlan,
  applyWorkstreamUpdatePlan,
  canonicalJson,
  createHandoffWorkstreamMigrationPlan,
  createReplicatedWorkstreamImportPlan,
  createWorkstreamStartPlan,
  createWorkstreamUpdatePlan,
  readCurrentWorkstream,
  sha256,
} from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workstream-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_workstream_test",
      now: new Date("2026-08-24T00:00:00.000Z"),
    }),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository workstreams", () => {
  it("imports a bounded remote head without requiring a local predecessor and rejects rollback", async () => {
    const root = await repository();
    const snapshot = {
      schemaVersion: 1 as const,
      workstreamId: "wks_abcdefabcdefabcdefabcdef",
      revision: 4,
      status: "active" as const,
      title: "Remote continuation",
      objective: "Resume a verified Hub workstream on this repository node.",
      nextActions: ["Continue the next bounded task."],
      blockers: [],
      notes: [],
      references: [],
      pendingDecisions: [],
      pendingApprovals: [],
      origin: {
        kind: "created" as const,
        sourceArtifactId: null,
        sourceContentHash: null,
        sourcePathDigest: null,
      },
      updatedAt: "2026-08-24T00:40:00.000Z",
    };
    const canonicalContent = `${canonicalJson(snapshot)}\n`;
    const plan = await createReplicatedWorkstreamImportPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
      snapshot,
      snapshotContentHash: sha256(canonicalContent),
      previousSnapshotContentHash: `sha256:${"a".repeat(64)}`,
    });
    expect(plan.status).toBe("ready");
    await applyReplicatedWorkstreamImportPlan({
      plan,
      now: new Date(),
      recordApplied: () => undefined,
    });
    expect(await readCurrentWorkstream(root)).toMatchObject({
      revision: 4,
      title: "Remote continuation",
    });
    const rollback = { ...snapshot, revision: 3, updatedAt: "2026-08-24T00:30:00.000Z" };
    const rollbackContent = `${canonicalJson(rollback)}\n`;
    await expect(
      createReplicatedWorkstreamImportPlan({
        repositoryRoot: root,
        projectId: "prj_workstream_test",
        snapshot: rollback,
        snapshotContentHash: sha256(rollbackContent),
        previousSnapshotContentHash: `sha256:${"b".repeat(64)}`,
      }),
    ).resolves.toMatchObject({ status: "blocked", blockers: [{ code: "non_advancing_revision" }] });
  });

  it("starts structured continuation state without a legacy document", async () => {
    const root = await repository();
    const draft = {
      schemaVersion: 1,
      status: "active",
      title: "Repository continuity",
      objective: "Make fresh agent sessions resume from verified state.",
      nextActions: ["Enforce a terminal checkpoint."],
      blockers: [],
      notes: [],
      references: [{ path: "docs/specifications/execution.md", label: "Execution contract" }],
      updatedAt: "2026-08-24T00:30:00.000Z",
    };
    const plan = await createWorkstreamStartPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
      draft,
    });
    expect(plan).toMatchObject({
      status: "ready",
      planKind: "workstream_start",
      snapshot: { revision: 1, origin: { kind: "created" } },
    });
    await applyWorkstreamStartPlan({
      plan,
      now: new Date("2026-08-24T00:31:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(await readCurrentWorkstream(root)).toMatchObject({
      title: "Repository continuity",
      revision: 1,
    });
    expect(
      (
        await createWorkstreamStartPlan({
          repositoryRoot: root,
          projectId: "prj_workstream_test",
          draft,
        })
      ).status,
    ).toBe("blocked");
  });

  it("starts a distinct goal after a settled cancellation but not after an unsettled one", async () => {
    const root = await repository();
    const draft = {
      schemaVersion: 1,
      status: "cancelled" as const,
      title: "Abandoned research goal",
      objective: "Retire one goal whose worker attempt could not be reconciled.",
      nextActions: [],
      blockers: ["The aborted attempt has no terminal event."],
      notes: [],
      references: [],
      updatedAt: "2026-08-24T01:00:00.000Z",
    };
    const unsettled = await createWorkstreamStartPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
      draft,
    });
    await applyWorkstreamStartPlan({
      plan: unsettled,
      now: new Date(),
      recordApplied: () => undefined,
    });
    const successorDraft = {
      ...draft,
      status: "active" as const,
      title: "Retry under a fresh goal",
      objective: "Prove the corrected worker run under separately reviewed authority.",
      nextActions: ["Bind one request."],
      blockers: [],
      updatedAt: "2026-08-24T02:00:00.000Z",
    };
    await expect(
      createWorkstreamStartPlan({
        repositoryRoot: root,
        projectId: "prj_workstream_test",
        draft: successorDraft,
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      blockers: [{ code: "current_workstream_exists" }],
    });
    const settled = await createWorkstreamUpdatePlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
      snapshot: {
        ...unsettled.snapshot!,
        revision: 2,
        blockers: [],
        notes: ["The aborted attempt is retired with its exact evidence."],
        updatedAt: "2026-08-24T01:30:00.000Z",
      },
    });
    await applyWorkstreamUpdatePlan({
      plan: settled,
      now: new Date(),
      recordApplied: () => undefined,
    });
    const next = await createWorkstreamStartPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
      draft: successorDraft,
    });
    expect(next).toMatchObject({
      status: "ready",
      snapshot: {
        origin: {
          kind: "successor",
          predecessorWorkstreamId: unsettled.snapshot!.workstreamId,
          predecessorSnapshotContentHash: settled.desiredSnapshotContentHash,
        },
      },
    });
  });

  it("starts a distinct goal after a settled completion and retains its predecessor binding", async () => {
    const root = await repository();
    const draft = {
      schemaVersion: 1,
      status: "completed" as const,
      title: "Accepted local research",
      objective: "Answer and independently accept one local research request.",
      nextActions: [],
      blockers: [],
      notes: [],
      references: [],
      updatedAt: "2026-08-24T01:00:00.000Z",
    };
    const first = await createWorkstreamStartPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
      draft,
    });
    await applyWorkstreamStartPlan({
      plan: first,
      now: new Date(),
      recordApplied: () => undefined,
    });
    const next = await createWorkstreamStartPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
      draft: {
        ...draft,
        status: "active",
        title: "Discord acceptance",
        objective: "Accept a separate authenticated Discord goal.",
        nextActions: ["Bind the new request."],
        updatedAt: "2026-08-24T02:00:00.000Z",
      },
    });
    expect(next).toMatchObject({
      status: "ready",
      currentSnapshotContentHash: first.desiredSnapshotContentHash,
      snapshot: {
        revision: 1,
        origin: {
          kind: "successor",
          predecessorWorkstreamId: first.snapshot!.workstreamId,
          predecessorSnapshotContentHash: first.desiredSnapshotContentHash,
        },
      },
      operations: [{ action: "update", expectedCurrentHash: first.desiredSnapshotContentHash }],
    });
    expect(next.snapshot!.workstreamId).not.toBe(first.snapshot!.workstreamId);
    await expect(
      createReplicatedWorkstreamImportPlan({
        repositoryRoot: root,
        projectId: "prj_workstream_test",
        snapshot: next.snapshot!,
        snapshotContentHash: next.desiredSnapshotContentHash!,
        previousSnapshotContentHash: first.desiredSnapshotContentHash!,
      }),
    ).resolves.toMatchObject({ status: "ready" });
    const receipt = await applyWorkstreamStartPlan({
      plan: next,
      now: new Date(),
      recordApplied: () => undefined,
    });
    expect(receipt.previousSnapshotContentHash).toBe(first.desiredSnapshotContentHash);
    expect(await readCurrentWorkstream(root)).toMatchObject({
      workstreamId: next.snapshot!.workstreamId,
      status: "active",
    });
  });

  it("atomically replaces a root HANDOFF with structured current state and retires its lifecycle record", async () => {
    const root = await repository();
    const handoff = [
      "# Atlas redesign handoff",
      "",
      "## Current objective",
      "",
      "Finish the bounded atlas migration.",
      "",
      "## Resume procedure",
      "",
      "1. Read `docs/architecture/atlas.md`.",
      "2. Run the focused tests.",
      "",
      "## Current deployment state",
      "",
      "- Preview is deployed.",
      "",
      "## Authoritative references",
      "",
      "- Architecture: `docs/architecture/atlas.md`",
      "",
    ].join("\n");
    await writeFile(resolve(root, "HANDOFF.md"), handoff);
    await writeFile(
      resolve(root, "AGENTS.md"),
      "# Agents\n\nWhen continuing, read `HANDOFF.md` first.\n",
    );
    await mkdir(resolve(root, "docs/knowledge"), { recursive: true });
    await writeFile(
      resolve(root, "docs/knowledge/index.md"),
      "# Generated\n\n[Handoff](../../HANDOFF.md)\n",
    );
    await mkdir(resolve(root, ".lervo/knowledge/document-normalizations/aa"), { recursive: true });
    await writeFile(
      resolve(
        root,
        ".lervo/knowledge/document-normalizations/aa/knormdoc_aaaaaaaaaaaaaaaaaaaaaaaa.yaml",
      ),
      "schemaVersion: 1\nrecordId: knormdoc_aaaaaaaaaaaaaaaaaaaaaaaa\nsourcePath: HANDOFF.md\n",
    );

    const plan = await createHandoffWorkstreamMigrationPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
    });
    expect(plan).toMatchObject({
      status: "review_required",
      sourcePath: "HANDOFF.md",
      referenceUpdates: [{ path: "AGENTS.md", replacementCount: 1 }],
    });
    expect(plan.removedNormalizationRecords).toHaveLength(1);
    let artifacts: { sourceContent: string; snapshotContent: string } | undefined;
    await applyHandoffWorkstreamMigrationPlan({
      plan,
      approvedOperationId: plan.operationId!,
      approvedHash: plan.approvalHash!,
      now: new Date("2026-08-24T01:00:00.000Z"),
      recordApplied: (_receipt, value) => {
        artifacts = value;
      },
    });

    await expect(access(resolve(root, "HANDOFF.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(
        resolve(
          root,
          ".lervo/knowledge/document-normalizations/aa/knormdoc_aaaaaaaaaaaaaaaaaaaaaaaa.yaml",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toContain(
      "run `lervo workstream current` first",
    );
    expect(await readFile(resolve(root, "docs/knowledge/index.md"), "utf8")).toContain(
      "HANDOFF.md",
    );
    const current = await readCurrentWorkstream(root);
    expect(current).toMatchObject({
      status: "active",
      title: "Atlas redesign handoff",
      objective: "Finish the bounded atlas migration.",
      nextActions: ["Read docs/architecture/atlas.md.", "Run the focused tests."],
      notes: ["Current deployment state: Preview is deployed."],
      references: [
        { path: "docs/architecture/atlas.md", label: "Architecture: docs/architecture/atlas.md" },
      ],
      origin: { kind: "legacy_continuation", sourceContentHash: plan.sourceContentHash },
    });
    expect(artifacts?.sourceContent).toBe(handoff);
    expect(JSON.parse(artifacts!.snapshotContent)).toEqual(current);
    expect(
      (
        await createHandoffWorkstreamMigrationPlan({
          repositoryRoot: root,
          projectId: "prj_workstream_test",
        })
      ).status,
    ).toBe("current");
  });

  it("rewrites root HANDOFF references as natural workstream access instructions", async () => {
    const root = await repository();
    await writeFile(
      resolve(root, "HANDOFF.md"),
      "# Current handoff\n\n## Current objective\n\nContinue safely.\n",
    );
    await writeFile(
      resolve(root, "AGENTS.md"),
      [
        "# Agents",
        "",
        "Before editing, read the root `HANDOFF.md` and the architecture guide.",
        "Follow root `HANDOFF.md` for current behavior.",
        "",
      ].join("\n"),
    );

    const plan = await createHandoffWorkstreamMigrationPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
    });
    await applyHandoffWorkstreamMigrationPlan({
      plan,
      approvedOperationId: plan.operationId!,
      approvedHash: plan.approvalHash!,
      now: new Date("2026-08-24T01:00:00.000Z"),
      recordApplied: () => undefined,
    });

    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toBe(
      [
        "# Agents",
        "",
        "Before editing, run `lervo workstream current` and the architecture guide.",
        "Follow the current workstream from `lervo workstream current` for current behavior.",
        "",
      ].join("\n"),
    );
  });

  it("discovers continuation state by content anywhere in the repository", async () => {
    const root = await repository();
    await mkdir(resolve(root, "notes/team"), { recursive: true });
    await writeFile(
      resolve(root, "notes/team/cobalt.md"),
      [
        "# Cobalt delivery",
        "",
        "## Current objective",
        "",
        "Complete the provider-neutral checkpoint.",
        "",
        "## Next actions",
        "",
        "- Exercise a fresh terminal session.",
        "",
      ].join("\n"),
    );
    await writeFile(
      resolve(root, "notes/index.md"),
      "# Notes\n\n[Current delivery](team/cobalt.md)\n",
    );
    const plan = await createHandoffWorkstreamMigrationPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
    });
    expect(plan).toMatchObject({
      planKind: "continuation_workstream",
      status: "review_required",
      sourcePath: "notes/team/cobalt.md",
      candidates: [
        {
          path: "notes/team/cobalt.md",
          signals: expect.arrayContaining(["objective_section", "next_action_section"]),
        },
      ],
    });
    await applyHandoffWorkstreamMigrationPlan({
      plan,
      approvedOperationId: plan.operationId!,
      approvedHash: plan.approvalHash!,
      now: new Date(),
      recordApplied: () => undefined,
    });
    expect(await readFile(resolve(root, "notes/team/cobalt.md"), "utf8")).toContain(
      "Complete the provider-neutral checkpoint.",
    );
    expect(await readFile(resolve(root, "notes/index.md"), "utf8")).toContain(
      "lervo workstream current",
    );
    expect(await readCurrentWorkstream(root)).toMatchObject({
      objective: "Complete the provider-neutral checkpoint.",
      origin: { kind: "legacy_continuation" },
    });
    expect(
      (
        await createHandoffWorkstreamMigrationPlan({
          repositoryRoot: root,
          projectId: "prj_workstream_test",
        })
      ).status,
    ).toBe("current");
  });

  it("does not merge ambiguous repository-wide continuation candidates", async () => {
    const root = await repository();
    await mkdir(resolve(root, "team/a"), { recursive: true });
    await mkdir(resolve(root, "team/b"), { recursive: true });
    const body = (name: string) =>
      `# ${name}\n\n## Objective\n\nContinue ${name}.\n\n## Next actions\n\n- Verify ${name}.\n`;
    await writeFile(resolve(root, "team/a/state.md"), body("A"));
    await writeFile(resolve(root, "team/b/progress.md"), body("B"));
    const plan = await createHandoffWorkstreamMigrationPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
    });
    expect(plan).toMatchObject({
      status: "blocked",
      blockers: [{ code: "ambiguous_continuation_sources" }],
    });
    expect(plan.candidates.map((item) => item.path)).toEqual([
      "team/b/progress.md",
      "team/a/state.md",
    ]);
  });

  it("does not promote historical candidates over an existing verified workstream", async () => {
    const root = await repository();
    const draft = {
      schemaVersion: 1,
      status: "active",
      title: "Current task",
      objective: "Keep the current identity.",
      nextActions: [],
      blockers: [],
      notes: [],
      references: [],
      updatedAt: "2026-08-24T02:10:00.000Z",
    };
    const start = await createWorkstreamStartPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
      draft,
    });
    await applyWorkstreamStartPlan({
      plan: start,
      now: new Date(),
      recordApplied: () => undefined,
    });
    await mkdir(resolve(root, "docs/repository/history"), { recursive: true });
    await writeFile(
      resolve(root, "docs/repository/history/old-session.md"),
      "# Old session\n\n## Objective\n\nOld work.\n\n## Next actions\n\n- Historical action.\n",
    );
    const plan = await createHandoffWorkstreamMigrationPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
    });
    expect(plan).toMatchObject({
      status: "current",
      workstream: null,
      candidates: [{ path: "docs/repository/history/old-session.md" }],
    });
    expect(await readCurrentWorkstream(root)).toMatchObject({ title: "Current task", revision: 1 });
  });

  it("rolls back state, references, records, and source when event recording fails", async () => {
    const root = await repository();
    await writeFile(
      resolve(root, "HANDOFF.md"),
      "# Recovery handoff\n\n## Current objective\n\nPreserve all bytes.\n",
    );
    await writeFile(resolve(root, "AGENTS.md"), "# Agents\n\nRead `HANDOFF.md`.\n");
    const plan = await createHandoffWorkstreamMigrationPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
    });
    await expect(
      applyHandoffWorkstreamMigrationPlan({
        plan,
        approvedOperationId: plan.operationId!,
        approvedHash: plan.approvalHash!,
        now: new Date(),
        recordApplied: () => {
          throw new Error("event unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "knowledge_apply_failed" });
    expect(await readFile(resolve(root, "HANDOFF.md"), "utf8")).toContain("Preserve all bytes");
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toContain("HANDOFF.md");
    expect(await readCurrentWorkstream(root)).toBeNull();
  });

  it("requires an exact revision increment for explicit updates", async () => {
    const root = await repository();
    await writeFile(
      resolve(root, "HANDOFF.md"),
      "# Update handoff\n\n## Current objective\n\nShip the first slice.\n",
    );
    const migration = await createHandoffWorkstreamMigrationPlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
    });
    await applyHandoffWorkstreamMigrationPlan({
      plan: migration,
      approvedOperationId: migration.operationId!,
      approvedHash: migration.approvalHash!,
      now: new Date(),
      recordApplied: () => undefined,
    });
    const current = (await readCurrentWorkstream(root))!;
    const desired = {
      ...current,
      revision: 2,
      status: "completed" as const,
      nextActions: [],
      updatedAt: "2026-08-24T02:00:00.000Z",
    };
    const plan = await createWorkstreamUpdatePlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
      snapshot: desired,
    });
    expect(plan.status).toBe("ready");
    await applyWorkstreamUpdatePlan({ plan, now: new Date(), recordApplied: () => undefined });
    expect(await readCurrentWorkstream(root)).toMatchObject({ revision: 2, status: "completed" });
    expect(
      (
        await createWorkstreamUpdatePlan({
          repositoryRoot: root,
          projectId: "prj_workstream_test",
          snapshot: desired,
        })
      ).status,
    ).toBe("blocked");
    const overLimit = await createWorkstreamUpdatePlan({
      repositoryRoot: root,
      projectId: "prj_workstream_test",
      snapshot: {
        ...(await readCurrentWorkstream(root))!,
        revision: 3,
        notes: Array.from({ length: 33 }, (_, index) => `Note ${index + 1}`),
        updatedAt: "2026-08-24T02:01:00.000Z",
      },
    });
    expect(overLimit.blockers).toContainEqual(
      expect.objectContaining({
        code: "invalid_snapshot",
        message: expect.stringContaining("/notes must NOT have more than 32 items"),
      }),
    );
  });
});
