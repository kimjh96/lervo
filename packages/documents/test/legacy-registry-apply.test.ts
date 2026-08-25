import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { loadDocumentManifests, loadDocumentRegistry } from "@lervo/project";
import type {
  DocumentManifest,
  DocumentRecord,
  DocumentRegistry,
  LegacyRegistryMigrationApproval,
} from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyLegacyRegistryMigration,
  calculateLegacyRegistryMigrationPlanId,
  createLegacyRegistryMigrationDryRun,
  type LegacyRegistryMigrationAppliedEvent,
  type LegacyRegistryMigrationCheckpoint,
  type LegacyRegistryMigrationDryRun,
} from "../src/index.js";

const roots: string[] = [];

function record(path: string): DocumentRecord {
  return {
    path,
    kind: "canonical",
    responsibleParty: { kind: "team", id: "maintainers" },
    connectedPaths: ["src"],
    verifiedRevision: "git:legacy",
    verifiedAt: "2026-08-19T00:00:00Z",
    reviewIntervalDays: 30,
    ownership: { mode: "user" },
  };
}

async function fixtureRoot(registry: DocumentRegistry): Promise<{
  root: string;
  registryBytes: Uint8Array;
}> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-legacy-registry-apply-"));
  roots.push(root);
  await mkdir(resolve(root, ".lervo"));
  const registryBytes = Buffer.from(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await writeFile(resolve(root, ".lervo/documents.yaml"), registryBytes);
  for (const item of Object.values(registry.documents)) {
    await mkdir(dirname(resolve(root, item.path)), { recursive: true });
    await writeFile(resolve(root, item.path), `# ${item.path}\n`);
  }
  return { root, registryBytes };
}

function manifestFor(dryRun: LegacyRegistryMigrationDryRun, documentId: string): DocumentManifest {
  const artifact = dryRun.entryArtifacts.find((item) => item.documentId === documentId);
  if (artifact === undefined) throw new Error("fixture legacy artifact is missing");
  return {
    schemaVersion: 1,
    documentId,
    record: structuredClone(artifact.record),
    contentPolicy: {
      mode: "user_managed",
      mediaType: "text/markdown; charset=utf-8",
      profileId: "project_document",
      locale: "ko-KR",
      audience: "human",
      metadataPlacement: "sidecar",
      historyMode: "separate_documents",
      splitStrategy: "topic_documents",
      automaticWrites: false,
      splitRecommendedAtBytes: 32768,
      oversizeReviewAtBytes: 65536,
      overflowAction: "report_split_recommended",
    },
    relations: {
      supersedesDocumentIds: [],
      relatedDocumentIds: [],
    },
  };
}

function approvalFor(
  dryRun: LegacyRegistryMigrationDryRun,
  skippedDocumentIds: ReadonlySet<string> = new Set(),
): LegacyRegistryMigrationApproval {
  return {
    schemaVersion: 1,
    approvalId: "apr_legacy_000001",
    planId: dryRun.plan.planId,
    approvedAt: "2026-08-19T02:00:00Z",
    approver: { kind: "user", id: "fixture-reviewer" },
    decisions: dryRun.plan.entries.map((entry) =>
      skippedDocumentIds.has(entry.documentId)
        ? {
            documentId: entry.documentId,
            artifactId: entry.artifactId,
            artifactHash: entry.artifactHash,
            action: "skip" as const,
            reasonCode: "excluded_by_reviewer",
          }
        : {
            documentId: entry.documentId,
            artifactId: entry.artifactId,
            artifactHash: entry.artifactHash,
            action: "approve_sidecar" as const,
            manifest: manifestFor(dryRun, entry.documentId),
          },
    ),
  };
}

async function plan(root: string): Promise<LegacyRegistryMigrationDryRun> {
  return createLegacyRegistryMigrationDryRun({
    repositoryRoot: root,
    generatedAt: "2026-08-19T01:00:00Z",
  });
}

async function expectLegacyLayoutRestored(input: {
  root: string;
  registryBytes: Uint8Array;
  archivePath: string;
}): Promise<void> {
  expect(await readFile(resolve(input.root, ".lervo/documents.yaml"))).toEqual(input.registryBytes);
  await expect(access(resolve(input.root, ".lervo/documents"))).rejects.toThrow();
  await expect(access(resolve(input.root, input.archivePath))).rejects.toThrow();
  await expect(access(resolve(input.root, ".lervo/.document-migration.lock"))).rejects.toThrow();
  expect(
    (await readdir(resolve(input.root, ".lervo"))).some((name) =>
      name.startsWith(".legacy-document-migration-"),
    ),
  ).toBe(false);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("legacy document registry structural migration apply", () => {
  it("archives the exact registry, deactivates it, and activates only approved sidecars", async () => {
    const { root, registryBytes } = await fixtureRoot({
      schemaVersion: 1,
      documents: {
        doc_guide_0000001: record("docs/guide.md"),
        doc_readme_000001: record("README.md"),
      },
    });
    const dryRun = await plan(root);
    const events: LegacyRegistryMigrationAppliedEvent[] = [];

    const receipt = await applyLegacyRegistryMigration({
      repositoryRoot: root,
      plan: dryRun.plan,
      entryArtifacts: dryRun.entryArtifacts,
      approval: approvalFor(dryRun, new Set(["doc_guide_0000001"])),
      appliedAt: "2026-08-19T03:00:00Z",
      eventRecorder: {
        record: (event) => {
          events.push(structuredClone(event));
        },
      },
    });

    await expect(access(resolve(root, ".lervo/documents.yaml"))).rejects.toThrow();
    expect(await readFile(resolve(root, receipt.archive.path))).toEqual(registryBytes);
    expect(receipt.created.map((item) => item.documentId)).toEqual(["doc_readme_000001"]);
    expect(receipt.skippedDocumentIds).toEqual(["doc_guide_0000001"]);
    expect((await loadDocumentManifests(root)).map((item) => item.documentId)).toEqual([
      "doc_readme_000001",
    ]);
    expect((await loadDocumentRegistry(root)).documents).toHaveProperty("doc_readme_000001");
    expect(events).toEqual([
      {
        type: "document.migration.applied",
        payload: receipt.eventPayload,
      },
    ]);
    expect(events[0]?.payload).not.toHaveProperty("approver");
    expect(events[0]?.payload).not.toHaveProperty("archivePath");
    expect(events[0]?.payload.migrationKind).toBe("legacy_registry_structural");
    await expect(access(resolve(root, ".lervo/.document-migration.lock"))).rejects.toThrow();
    expect(
      (await readdir(resolve(root, ".lervo"))).some((name) =>
        name.startsWith(".legacy-document-migration-"),
      ),
    ).toBe(false);
  });

  it("requires one exact decision per entry and preserves the original record", async () => {
    const { root } = await fixtureRoot({
      schemaVersion: 1,
      documents: { doc_readme_000001: record("README.md") },
    });
    const dryRun = await plan(root);
    const missing = approvalFor(dryRun);
    missing.decisions = [];
    await expect(
      applyLegacyRegistryMigration({
        repositoryRoot: root,
        plan: dryRun.plan,
        entryArtifacts: dryRun.entryArtifacts,
        approval: missing,
        appliedAt: "2026-08-19T03:00:00Z",
        eventRecorder: { record: () => undefined },
      }),
    ).rejects.toMatchObject({ code: "invalid_approval" });

    const changedRecord = approvalFor(dryRun);
    const decision = changedRecord.decisions[0];
    if (decision?.action !== "approve_sidecar") throw new Error("fixture approval is missing");
    decision.manifest.record.reviewIntervalDays = 60;
    await expect(
      applyLegacyRegistryMigration({
        repositoryRoot: root,
        plan: dryRun.plan,
        entryArtifacts: dryRun.entryArtifacts,
        approval: changedRecord,
        appliedAt: "2026-08-19T03:00:00Z",
        eventRecorder: { record: () => undefined },
      }),
    ).rejects.toMatchObject({ code: "invalid_approval" });

    const redirectedArchive = structuredClone(dryRun.plan);
    redirectedArchive.archiveTarget.path =
      ".lervo/archive/document-registries/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.yaml";
    redirectedArchive.planId = calculateLegacyRegistryMigrationPlanId(redirectedArchive);
    const redirectedApproval = approvalFor(dryRun);
    redirectedApproval.planId = redirectedArchive.planId;
    await expect(
      applyLegacyRegistryMigration({
        repositoryRoot: root,
        plan: redirectedArchive,
        entryArtifacts: dryRun.entryArtifacts,
        approval: redirectedApproval,
        appliedAt: "2026-08-19T03:00:00Z",
        eventRecorder: { record: () => undefined },
      }),
    ).rejects.toMatchObject({ code: "invalid_migration_artifact" });

    const missingReference = structuredClone(dryRun.plan);
    missingReference.referencedDocuments = [];
    missingReference.planId = calculateLegacyRegistryMigrationPlanId(missingReference);
    const missingReferenceApproval = approvalFor(dryRun);
    missingReferenceApproval.planId = missingReference.planId;
    await expect(
      applyLegacyRegistryMigration({
        repositoryRoot: root,
        plan: missingReference,
        entryArtifacts: dryRun.entryArtifacts,
        approval: missingReferenceApproval,
        appliedAt: "2026-08-19T03:00:00Z",
        eventRecorder: { record: () => undefined },
      }),
    ).rejects.toMatchObject({ code: "invalid_migration_artifact" });
  });

  it("rejects stale registry and referenced document snapshots without writes", async () => {
    const sourceFixture = await fixtureRoot({
      schemaVersion: 1,
      documents: { doc_readme_000001: record("README.md") },
    });
    const sourcePlan = await plan(sourceFixture.root);
    await writeFile(resolve(sourceFixture.root, ".lervo/documents.yaml"), "changed: true\n");
    await expect(
      applyLegacyRegistryMigration({
        repositoryRoot: sourceFixture.root,
        plan: sourcePlan.plan,
        entryArtifacts: sourcePlan.entryArtifacts,
        approval: approvalFor(sourcePlan),
        appliedAt: "2026-08-19T03:00:00Z",
        eventRecorder: { record: () => undefined },
      }),
    ).rejects.toMatchObject({ code: "plan_stale" });
    await expect(
      access(resolve(sourceFixture.root, sourcePlan.plan.archiveTarget.path)),
    ).rejects.toThrow();

    const referenceFixture = await fixtureRoot({
      schemaVersion: 1,
      documents: { doc_readme_000001: record("README.md") },
    });
    const referencePlan = await plan(referenceFixture.root);
    await writeFile(resolve(referenceFixture.root, "README.md"), "# Changed\n");
    await expect(
      applyLegacyRegistryMigration({
        repositoryRoot: referenceFixture.root,
        plan: referencePlan.plan,
        entryArtifacts: referencePlan.entryArtifacts,
        approval: approvalFor(referencePlan),
        appliedAt: "2026-08-19T03:00:00Z",
        eventRecorder: { record: () => undefined },
      }),
    ).rejects.toMatchObject({ code: "plan_stale" });
    await expectLegacyLayoutRestored({
      root: referenceFixture.root,
      registryBytes: referenceFixture.registryBytes,
      archivePath: referencePlan.plan.archiveTarget.path,
    });
  });

  it("rolls back every pre-event transition checkpoint without a mixed layout", async () => {
    const checkpoints: LegacyRegistryMigrationCheckpoint[] = [
      "staged",
      "archive_published",
      "marker_published",
      "sidecars_published",
      "legacy_deactivated",
      "before_event",
    ];
    for (const checkpoint of checkpoints) {
      const fixture = await fixtureRoot({
        schemaVersion: 1,
        documents: { doc_readme_000001: record("README.md") },
      });
      const dryRun = await plan(fixture.root);
      let eventCount = 0;
      await expect(
        applyLegacyRegistryMigration({
          repositoryRoot: fixture.root,
          plan: dryRun.plan,
          entryArtifacts: dryRun.entryArtifacts,
          approval: approvalFor(dryRun),
          appliedAt: "2026-08-19T03:00:00Z",
          eventRecorder: {
            record: () => {
              eventCount += 1;
            },
          },
          failureInjector: (current) => {
            if (current === checkpoint) throw new Error(`fail:${checkpoint}`);
          },
        }),
      ).rejects.toMatchObject({
        code: checkpoint === "before_event" ? "migration_apply_failed" : expect.any(String),
      });
      expect(eventCount).toBe(0);
      await expectLegacyLayoutRestored({
        root: fixture.root,
        registryBytes: fixture.registryBytes,
        archivePath: dryRun.plan.archiveTarget.path,
      });
      expect((await loadDocumentRegistry(fixture.root)).documents).toHaveProperty(
        "doc_readme_000001",
      );
    }
  });

  it("rolls back on event failure and stays fail-closed after a committed event", async () => {
    const failedFixture = await fixtureRoot({
      schemaVersion: 1,
      documents: { doc_readme_000001: record("README.md") },
    });
    const failedPlan = await plan(failedFixture.root);
    await expect(
      applyLegacyRegistryMigration({
        repositoryRoot: failedFixture.root,
        plan: failedPlan.plan,
        entryArtifacts: failedPlan.entryArtifacts,
        approval: approvalFor(failedPlan),
        appliedAt: "2026-08-19T03:00:00Z",
        eventRecorder: {
          record: () => {
            throw new Error("event failed");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "telemetry_recording_failed" });
    await expectLegacyLayoutRestored({
      root: failedFixture.root,
      registryBytes: failedFixture.registryBytes,
      archivePath: failedPlan.plan.archiveTarget.path,
    });

    const committedFixture = await fixtureRoot({
      schemaVersion: 1,
      documents: { doc_readme_000001: record("README.md") },
    });
    const committedPlan = await plan(committedFixture.root);
    let eventCount = 0;
    await expect(
      applyLegacyRegistryMigration({
        repositoryRoot: committedFixture.root,
        plan: committedPlan.plan,
        entryArtifacts: committedPlan.entryArtifacts,
        approval: approvalFor(committedPlan),
        appliedAt: "2026-08-19T03:00:00Z",
        eventRecorder: {
          record: () => {
            eventCount += 1;
          },
        },
        failureInjector: (checkpoint) => {
          if (checkpoint === "event_recorded") throw new Error("finalize failed");
        },
      }),
    ).rejects.toMatchObject({ code: "migration_finalization_failed" });
    expect(eventCount).toBe(1);
    expect(
      await readFile(resolve(committedFixture.root, ".lervo/.document-migration.lock"), "utf8"),
    ).toContain(committedPlan.plan.planId);
    await expect(loadDocumentRegistry(committedFixture.root)).rejects.toMatchObject({
      code: "document_layout_conflict",
    });
  });

  it("reuses an exact preexisting archive and never removes it during rollback", async () => {
    const fixture = await fixtureRoot({
      schemaVersion: 1,
      documents: { doc_readme_000001: record("README.md") },
    });
    const initial = await plan(fixture.root);
    const archive = resolve(fixture.root, initial.plan.archiveTarget.path);
    await mkdir(dirname(archive), { recursive: true });
    await writeFile(archive, fixture.registryBytes);
    const dryRun = await plan(fixture.root);
    expect(dryRun.plan.archiveTarget.expected.kind).toBe("file");

    await expect(
      applyLegacyRegistryMigration({
        repositoryRoot: fixture.root,
        plan: dryRun.plan,
        entryArtifacts: dryRun.entryArtifacts,
        approval: approvalFor(dryRun),
        appliedAt: "2026-08-19T03:00:00Z",
        eventRecorder: {
          record: () => {
            throw new Error("event failed");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "telemetry_recording_failed" });

    expect(await readFile(archive)).toEqual(fixture.registryBytes);
    expect(await readFile(resolve(fixture.root, ".lervo/documents.yaml"))).toEqual(
      fixture.registryBytes,
    );
    await expect(access(resolve(fixture.root, ".lervo/documents"))).rejects.toThrow();
    await expect(
      access(resolve(fixture.root, ".lervo/.document-migration.lock")),
    ).rejects.toThrow();
  });

  it("keeps the marker when rollback cannot prove the published layout is unchanged", async () => {
    const fixture = await fixtureRoot({
      schemaVersion: 1,
      documents: { doc_readme_000001: record("README.md") },
    });
    const dryRun = await plan(fixture.root);
    await expect(
      applyLegacyRegistryMigration({
        repositoryRoot: fixture.root,
        plan: dryRun.plan,
        entryArtifacts: dryRun.entryArtifacts,
        approval: approvalFor(dryRun),
        appliedAt: "2026-08-19T03:00:00Z",
        eventRecorder: { record: () => undefined },
        failureInjector: async (checkpoint) => {
          if (checkpoint !== "before_event") return;
          await writeFile(
            resolve(fixture.root, ".lervo/documents/doc_readme_000001.yaml"),
            "externally changed\n",
          );
          throw new Error("rollback must fail closed");
        },
      }),
    ).rejects.toMatchObject({ code: "rollback_failed" });

    expect(
      await readFile(resolve(fixture.root, ".lervo/.document-migration.lock"), "utf8"),
    ).toContain(dryRun.plan.planId);
    await expect(loadDocumentRegistry(fixture.root)).rejects.toMatchObject({
      code: "document_layout_conflict",
    });
  });

  it("can explicitly exclude every entry while preserving the registry archive", async () => {
    const fixture = await fixtureRoot({
      schemaVersion: 1,
      documents: { doc_readme_000001: record("README.md") },
    });
    const dryRun = await plan(fixture.root);
    const receipt = await applyLegacyRegistryMigration({
      repositoryRoot: fixture.root,
      plan: dryRun.plan,
      entryArtifacts: dryRun.entryArtifacts,
      approval: approvalFor(dryRun, new Set(["doc_readme_000001"])),
      appliedAt: "2026-08-19T03:00:00Z",
      eventRecorder: { record: () => undefined },
    });
    expect(receipt.created).toEqual([]);
    expect(receipt.skippedDocumentIds).toEqual(["doc_readme_000001"]);
    expect((await loadDocumentRegistry(fixture.root)).documents).toEqual({});
    expect(await readFile(resolve(fixture.root, receipt.archive.path))).toEqual(
      fixture.registryBytes,
    );
  });
});
