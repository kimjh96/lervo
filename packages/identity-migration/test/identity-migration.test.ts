import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  applyInitPlan,
  createInitPlan,
  loadDocumentManifests,
  serializeYaml,
} from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import type { DocumentManifest } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { applyIdentityMigration, createIdentityMigrationPlan } from "../src/index.js";

const roots: string[] = [];
const projectId = "prj_identity_0001";
const policyVersion = `sha256:${"a".repeat(64)}`;

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-identity-migration-"));
  roots.push(root);
  return root;
}

async function previousVersionRepository(): Promise<{
  root: string;
  eventHash: string;
  artifactUri: string;
}> {
  const root = await temporaryRepository();
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId,
      now: new Date("2026-08-18T00:00:00Z"),
    }),
  );
  const storage = await openProjectStorage(root);
  const artifact = await storage.artifacts.put(
    "Evidence source text preserved independently of the name",
  );
  const event = storage.events.append({
    eventId: "evt_identity_source_01",
    projectId,
    runId: "run_identity_source_01",
    sessionId: "ses_identity_source_01",
    type: "run.completed",
    occurredAt: "2026-08-18T00:01:00Z",
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion,
    payload: {
      resultDigest: artifact.contentHash,
      artifactIds: [`art_${artifact.contentHash.slice(7)}`],
      verificationStatus: "not_run",
    },
  }).event;
  await storage.close();
  await mkdir(resolve(root, ".lervo/state"), { recursive: true });
  await rename(
    resolve(root, ".lervo/data/events.sqlite"),
    resolve(root, ".lervo/state/events.sqlite"),
  );
  await rename(resolve(root, ".lervo/data/cas"), resolve(root, ".lervo/state/cas"));
  await rm(resolve(root, ".lervo/data"), { recursive: true, force: true });
  for (const directory of [
    "verifications",
    "deliberations",
    "search-evaluations",
    "search-engine-policies",
    "search-rollout-policies",
    "search-rollout-action-policies",
  ])
    await rmdir(resolve(root, ".lervo", directory)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  await rename(resolve(root, ".lervo"), resolve(root, ".roven"));
  return { root, eventHash: event.eventHash, artifactUri: artifact.uri };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project identity migration", () => {
  it("creates a read-only content-bound plan for the previous managed directory", async () => {
    const fixture = await previousVersionRepository();

    const plan = await createIdentityMigrationPlan(fixture.root);

    expect(plan).toMatchObject({
      status: "ready",
      projectId,
      preservedEventCount: 1,
      preservedEventHeadHash: fixture.eventHash,
      verifiedCasObjectCount: 1,
    });
    expect(plan.missingCurrentDirectories).toContain(".lervo/verifications");
    expect(plan.sourceTreeHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(access(resolve(fixture.root, ".roven"))).resolves.toBeUndefined();
    await expect(access(resolve(fixture.root, ".lervo"))).rejects.toThrow();
  });

  it("moves the root atomically, preserves the chain prefix and CAS bytes, then appends completion", async () => {
    const fixture = await previousVersionRepository();
    const plan = await createIdentityMigrationPlan(fixture.root);
    expect(await createIdentityMigrationPlan(fixture.root)).toEqual(plan);

    const receipt = await applyIdentityMigration(plan, {
      now: new Date("2026-08-22T05:00:00Z"),
    });

    expect(receipt).toMatchObject({
      projectId,
      preservedEventCount: 1,
      preservedEventHeadHash: fixture.eventHash,
      verifiedCasObjectCount: 1,
      migratedAt: "2026-08-22T05:00:00.000Z",
    });
    await expect(access(resolve(fixture.root, ".roven"))).rejects.toThrow();
    await expect(access(resolve(fixture.root, ".lervo/verifications"))).resolves.toBeUndefined();

    const storage = await openProjectStorage(fixture.root);
    const events = storage.events.list({ limit: 10 });
    expect(events).toHaveLength(2);
    expect(events[0]?.eventHash).toBe(fixture.eventHash);
    expect(events[1]).toMatchObject({
      eventId: receipt.completionEventId,
      type: "project.identity.migrated",
      previousHash: fixture.eventHash,
    });
    expect(Buffer.from(await storage.artifacts.get(fixture.artifactUri)).toString("utf8")).toBe(
      "Evidence source text preserved independently of the name",
    );
    await storage.close();
  });

  it("rejects an approved plan after any source byte changes", async () => {
    const fixture = await previousVersionRepository();
    const plan = await createIdentityMigrationPlan(fixture.root);
    await writeFile(resolve(fixture.root, ".roven/extra.txt"), "Changed after planning\n");

    await expect(applyIdentityMigration(plan)).rejects.toMatchObject({ code: "plan_stale" });
    await expect(access(resolve(fixture.root, ".roven"))).resolves.toBeUndefined();
    await expect(access(resolve(fixture.root, ".lervo"))).rejects.toThrow();
  });

  it("uses the freshly recomputed plan instead of caller-mutated apply fields", async () => {
    const fixture = await previousVersionRepository();
    const plan = await createIdentityMigrationPlan(fixture.root);
    const tampered = {
      ...plan,
      projectId: "prj_tampered_0001",
      missingCurrentDirectories: [".lervo/../../lervo-identity-escape-fixture"],
    };

    const receipt = await applyIdentityMigration(tampered);

    expect(receipt.projectId).toBe(projectId);
    await expect(
      access(resolve(fixture.root, "../lervo-identity-escape-fixture")),
    ).rejects.toThrow();
  });

  it("archives previous managed document metadata without rewriting the user document", async () => {
    const fixture = await previousVersionRepository();
    const previous = "ro" + "ven";
    const documentBytes = `User paragraph\n\n<!-- ${previous}:begin block=summary schema=1 -->\nManaged content\n<!-- ${previous}:end block=summary -->\n`;
    await writeFile(resolve(fixture.root, "README.md"), documentBytes);
    const manifest: DocumentManifest = {
      schemaVersion: 1,
      documentId: "doc_identity_0001",
      record: {
        path: "README.md",
        kind: "canonical",
        responsibleParty: { kind: "team", id: "product" },
        connectedPaths: ["README.md"],
        verifiedRevision: "fixture-revision",
        verifiedAt: "2026-08-18T00:00:00Z",
        reviewIntervalDays: 30,
        ownership: {
          mode: "managed_blocks",
          outsideManagedBlocks: "preserve",
          blocks: [
            {
              blockId: "summary",
              startMarker: `<!-- lervo:begin block=summary schema=1 -->`,
              endMarker: `<!-- lervo:end block=summary -->`,
              inputs: [{ sourceId: "fixture", contentHash: policyVersion }],
            },
          ],
        },
      },
      contentPolicy: {
        mode: "managed_blocks",
        mediaType: "text/markdown; charset=utf-8",
        profileId: "project.summary",
        locale: "ko-KR",
        audience: "mixed",
        metadataPlacement: "sidecar",
        historyMode: "separate_documents",
        splitStrategy: "topic_documents",
        writeScope: "declared_blocks_only",
        maxBlockBytes: 8192,
        overflowAction: "split_and_link",
      },
      relations: { supersedesDocumentIds: [], relatedDocumentIds: [] },
    };
    const previousManifest = serializeYaml(manifest).replaceAll("<!-- lervo:", `<!-- ${previous}:`);
    const sourceManifest = resolve(fixture.root, ".roven/documents/doc_identity_0001.yaml");
    await mkdir(resolve(fixture.root, ".roven/documents"), { recursive: true });
    await writeFile(sourceManifest, previousManifest);

    const plan = await createIdentityMigrationPlan(fixture.root);
    expect(plan.status).toBe("ready");
    expect(plan.documentDisposition).toBe("archive_previous_metadata");
    const receipt = await applyIdentityMigration(plan);

    expect(await readFile(resolve(fixture.root, "README.md"), "utf8")).toBe(documentBytes);
    expect(receipt.documentArchivePath).not.toBeNull();
    expect(
      await readFile(
        resolve(fixture.root, receipt.documentArchivePath!, "doc_identity_0001.yaml"),
        "utf8",
      ),
    ).toBe(previousManifest);
    await expect(loadDocumentManifests(fixture.root)).resolves.toEqual([]);
  });

  it("blocks mixed roots and corrupt CAS objects without changing either", async () => {
    const fixture = await previousVersionRepository();
    await writeFile(resolve(fixture.root, ".lervo"), "User file\n");
    const mixed = await createIdentityMigrationPlan(fixture.root);
    expect(mixed.status).toBe("blocked");
    expect(mixed.blockers).toContainEqual(expect.objectContaining({ code: "target_exists" }));
    await rm(resolve(fixture.root, ".lervo"));

    const objectRoot = resolve(fixture.root, ".roven/state/cas/sha256");
    const prefixName = (await readdir(objectRoot))[0]!;
    const suffixName = (await readdir(resolve(objectRoot, prefixName)))[0]!;
    await writeFile(resolve(objectRoot, prefixName, suffixName), "corrupted bytes");
    const corrupt = await createIdentityMigrationPlan(fixture.root);
    expect(corrupt.status).toBe("blocked");
    expect(corrupt.blockers).toContainEqual(expect.objectContaining({ code: "cas_invalid" }));
    await expect(access(resolve(fixture.root, ".roven"))).resolves.toBeUndefined();
  });
});
