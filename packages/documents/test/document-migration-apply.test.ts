import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import {
  applyInitPlan,
  createInitPlan,
  loadDocumentManifests,
} from "@lervo/project";
import type {
  DocumentManifest,
  DocumentMigrationApproval,
} from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDocumentMigration,
  createDocumentMigrationDryRun,
  type DocumentMigrationAppliedEvent,
  type DocumentMigrationDryRun,
} from "../src/index.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-document-apply-"));
  roots.push(root);
  return root;
}

async function initializedRoot(files: Record<string, string>): Promise<string> {
  const root = await temporaryRoot();
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), content);
  }
  await applyInitPlan(await createInitPlan({
    root,
    name: "migration-fixture",
    projectId: "prj_migration_01",
    now: new Date("2026-08-19T00:00:00Z"),
  }));
  return root;
}

function manifestFor(
  dryRun: DocumentMigrationDryRun,
  candidateId: string,
): DocumentManifest {
  const candidate = dryRun.candidateArtifacts.find(
    (artifact) => artifact.candidate.candidateId === candidateId,
  )?.candidate;
  if (candidate?.proposal === null || candidate?.proposal === undefined) {
    throw new Error("fixture candidate has no document proposal");
  }
  return {
    schemaVersion: 1,
    documentId: candidate.proposal.documentId,
    record: {
      path: candidate.proposal.documentPath,
      kind: "canonical",
      responsibleParty: { kind: "team", id: "maintainers" },
      connectedPaths: ["src"],
      verifiedRevision: `working-tree:${candidate.source.contentHash}`,
      verifiedAt: "2026-08-19T01:00:00Z",
      reviewIntervalDays: 30,
      ownership: { mode: "user" },
    },
    contentPolicy: {
      mode: "user_managed",
      mediaType: "text/markdown; charset=utf-8",
      profileId: candidate.proposal.profileId,
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
      supersedesDocumentIds: [...candidate.proposal.relations.supersedesDocumentIds],
      relatedDocumentIds: [...candidate.proposal.relations.relatedDocumentIds],
    },
  };
}

function approvalFor(dryRun: DocumentMigrationDryRun): DocumentMigrationApproval {
  return {
    schemaVersion: 1,
    approvalId: "apr_migration_0001",
    planId: dryRun.plan.planId,
    approvedAt: "2026-08-19T01:00:00Z",
    approver: { kind: "user", id: "fixture-reviewer" },
    decisions: dryRun.plan.candidates.map((entry) => {
      const artifact = dryRun.candidateArtifacts.find(
        (item) => item.candidate.candidateId === entry.candidateId,
      );
      if (artifact === undefined) throw new Error("fixture artifact is missing");
      if (entry.action === "observe_only") {
        return {
          candidateId: entry.candidateId,
          artifactId: entry.artifactId,
          artifactHash: entry.artifactHash,
          action: "skip" as const,
          reasonCode: "remain_observed",
        };
      }
      return {
        candidateId: entry.candidateId,
        artifactId: entry.artifactId,
        artifactHash: entry.artifactHash,
        action: "approve_sidecar" as const,
        manifest: manifestFor(dryRun, entry.candidateId),
      };
    }),
  };
}

async function dryRun(root: string, paths: readonly string[]): Promise<DocumentMigrationDryRun> {
  return createDocumentMigrationDryRun({
    repositoryRoot: root,
    roots: paths,
    generatedAt: "2026-08-19T00:30:00Z",
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("metadata-only document migration apply", () => {
  it("creates reviewed sidecars, records a privacy-bounded event, and preserves source bytes", async () => {
    const root = await initializedRoot({
      "README.md": "# Project\n\n사람이 작성한 원본입니다.\n",
      "docs/guide.md": "# Guide\n\n기존 안내 문서입니다.\n",
    });
    const beforeReadme = await readFile(resolve(root, "README.md"));
    const beforeGuide = await readFile(resolve(root, "docs/guide.md"));
    const planned = await dryRun(root, ["README.md", "docs/guide.md"]);
    const events: DocumentMigrationAppliedEvent[] = [];

    const receipt = await applyDocumentMigration({
      repositoryRoot: root,
      plan: planned.plan,
      candidateArtifacts: planned.candidateArtifacts,
      approval: approvalFor(planned),
      appliedAt: "2026-08-19T02:00:00Z",
      eventRecorder: { record: (event) => { events.push(structuredClone(event)); } },
    });

    expect(receipt.created).toHaveLength(2);
    expect(receipt.skippedCandidateIds).toEqual([]);
    expect(events).toEqual([{
      type: "document.migration.applied",
      payload: receipt.eventPayload,
    }]);
    expect(events[0]?.payload).not.toHaveProperty("approver");
    expect(events[0]?.payload).not.toHaveProperty("sourcePaths");
    expect(events[0]?.payload.beforeLayoutHash).not.toBe(
      events[0]?.payload.afterLayoutHash,
    );
    expect(await readFile(resolve(root, "README.md"))).toEqual(beforeReadme);
    expect(await readFile(resolve(root, "docs/guide.md"))).toEqual(beforeGuide);
    expect((await loadDocumentManifests(root)).map((manifest) => manifest.documentId).sort())
      .toEqual(receipt.created.map((item) => item.documentId).sort());
    expect((await readdir(resolve(root, ".lervo", "documents"))).sort())
      .toEqual(receipt.created.map((item) => `${item.documentId}.yaml`).sort());
    expect((await readdir(resolve(root, ".lervo"))).some(
      (name) => name.startsWith(".document-migration-"),
    )).toBe(false);
  });

  it("rejects changed sources and targets without writing or recording success", async () => {
    const sourceRoot = await initializedRoot({ "README.md": "# Before\n" });
    const sourcePlan = await dryRun(sourceRoot, ["README.md"]);
    await writeFile(resolve(sourceRoot, "README.md"), "# After\n");
    let sourceEvents = 0;
    await expect(applyDocumentMigration({
      repositoryRoot: sourceRoot,
      plan: sourcePlan.plan,
      candidateArtifacts: sourcePlan.candidateArtifacts,
      approval: approvalFor(sourcePlan),
      eventRecorder: { record: () => { sourceEvents += 1; } },
    })).rejects.toMatchObject({ code: "plan_stale" });
    expect(sourceEvents).toBe(0);
    expect(await readdir(resolve(sourceRoot, ".lervo", "documents"))).toEqual([]);

    const targetRoot = await initializedRoot({ "README.md": "# Target\n" });
    const targetPlan = await dryRun(targetRoot, ["README.md"]);
    const target = targetPlan.plan.candidates[0]?.target;
    if (target === null || target === undefined) throw new Error("fixture target is missing");
    await writeFile(resolve(targetRoot, target.path), "user-owned target bytes\n");
    await expect(applyDocumentMigration({
      repositoryRoot: targetRoot,
      plan: targetPlan.plan,
      candidateArtifacts: targetPlan.candidateArtifacts,
      approval: approvalFor(targetPlan),
      eventRecorder: { record: () => undefined },
    })).rejects.toMatchObject({ code: "plan_stale" });
    expect(await readFile(resolve(targetRoot, target.path), "utf8"))
      .toBe("user-owned target bytes\n");
  });

  it("rejects tampered plans, artifacts, and mismatched reviewed manifests", async () => {
    const root = await initializedRoot({ "README.md": "# Integrity\n" });
    const planned = await dryRun(root, ["README.md"]);
    await expect(applyDocumentMigration({
      repositoryRoot: root,
      plan: { ...planned.plan, warnings: ["tampered_warning"] },
      candidateArtifacts: planned.candidateArtifacts,
      approval: approvalFor(planned),
      appliedAt: "2026-08-19T02:00:00Z",
      eventRecorder: { record: () => undefined },
    })).rejects.toMatchObject({ code: "invalid_migration_artifact" });

    const tamperedArtifacts = structuredClone(planned.candidateArtifacts);
    tamperedArtifacts[0]!.candidate.warnings.push("tampered_warning");
    await expect(applyDocumentMigration({
      repositoryRoot: root,
      plan: planned.plan,
      candidateArtifacts: tamperedArtifacts,
      approval: approvalFor(planned),
      appliedAt: "2026-08-19T02:00:00Z",
      eventRecorder: { record: () => undefined },
    })).rejects.toMatchObject({ code: "invalid_migration_artifact" });

    const prematureApproval = approvalFor(planned);
    prematureApproval.approvedAt = "2026-08-19T00:00:00Z";
    await expect(applyDocumentMigration({
      repositoryRoot: root,
      plan: planned.plan,
      candidateArtifacts: planned.candidateArtifacts,
      approval: prematureApproval,
      appliedAt: "2026-08-19T02:00:00Z",
      eventRecorder: { record: () => undefined },
    })).rejects.toMatchObject({ code: "invalid_approval" });

    const approval = approvalFor(planned);
    const approved = approval.decisions[0];
    if (approved?.action !== "approve_sidecar") throw new Error("fixture approval is missing");
    approved.manifest.record.path = "docs/other.md";
    await expect(applyDocumentMigration({
      repositoryRoot: root,
      plan: planned.plan,
      candidateArtifacts: planned.candidateArtifacts,
      approval,
      appliedAt: "2026-08-19T02:00:00Z",
      eventRecorder: { record: () => undefined },
    })).rejects.toMatchObject({ code: "invalid_approval" });
    expect(await readdir(resolve(root, ".lervo", "documents"))).toEqual([]);
  });

  it("rolls every sidecar back when durable event recording fails", async () => {
    const root = await initializedRoot({
      "a.md": "# A\n",
      "b.md": "# B\n",
    });
    const planned = await dryRun(root, ["a.md", "b.md"]);
    await expect(applyDocumentMigration({
      repositoryRoot: root,
      plan: planned.plan,
      candidateArtifacts: planned.candidateArtifacts,
      approval: approvalFor(planned),
      appliedAt: "2026-08-19T02:00:00Z",
      eventRecorder: { record: () => { throw new Error("fixture telemetry failure"); } },
    })).rejects.toMatchObject({ code: "telemetry_recording_failed" });

    expect(await readdir(resolve(root, ".lervo", "documents"))).toEqual([]);
    expect((await readdir(resolve(root, ".lervo"))).some(
      (name) => name.startsWith(".document-migration-"),
    )).toBe(false);
    expect(await readFile(resolve(root, "a.md"), "utf8")).toBe("# A\n");
    expect(await readFile(resolve(root, "b.md"), "utf8")).toBe("# B\n");
  });

  it("does not activate sidecars beside a legacy registry", async () => {
    const root = await temporaryRoot();
    await mkdir(resolve(root, ".lervo"));
    const legacy = {
      schemaVersion: 1,
      documents: {
        doc_legacy_000001: {
          path: "guide.txt",
          kind: "canonical",
          responsibleParty: { kind: "team", id: "maintainers" },
          connectedPaths: ["src"],
          verifiedRevision: "git:legacy",
          verifiedAt: "2026-08-19T00:00:00Z",
          reviewIntervalDays: 30,
          ownership: { mode: "user" },
        },
      },
    };
    await writeFile(resolve(root, ".lervo", "documents.yaml"), `${JSON.stringify(legacy)}\n`);
    await writeFile(resolve(root, "guide.txt"), "legacy source\n");
    const planned = await dryRun(root, [".lervo/documents.yaml", "guide.txt"]);
    await expect(applyDocumentMigration({
      repositoryRoot: root,
      plan: planned.plan,
      candidateArtifacts: planned.candidateArtifacts,
      approval: approvalFor(planned),
      eventRecorder: { record: () => undefined },
    })).rejects.toMatchObject({ code: "migration_conflict" });
    expect(await readFile(resolve(root, ".lervo", "documents.yaml"), "utf8"))
      .toBe(`${JSON.stringify(legacy)}\n`);
  });
});
