import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyEventWriterBackupRetention,
  planEventWriterBackupRetention,
  type EventWriterBackupRetentionPorts,
} from "../src/event-writer-backup-retention.js";
import {
  eventWriterBackupRetentionLines,
  eventWriterBackupRetentionReceiptLines,
} from "../src/event-writer-backup-retention-format.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const NOW = new Date("2026-11-27T12:00:00.000Z");
const DAY = 86_400_000;

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-backup-retention-"));
  roots.push(root);
  return root;
}

function backups(root: string, ...parts: string[]): string {
  return resolve(root, ".lervo/data/event-writer-backups", ...parts);
}

/** A backup laid out as `createEventWriterActivationBackup` writes it. */
async function backup(root: string, version: number, daysAgo: number): Promise<void> {
  const directory = backups(root, `schema-${version}`);
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "events.sqlite"),
    Buffer.concat([Buffer.from("SQLite format 3\0", "latin1"), Buffer.alloc(1024)]),
  );
  await writeFile(resolve(directory, "event-contract.json"), "{}\n");
  await writeFile(
    resolve(directory, "backup.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "event_writer_activation_backup",
      createdAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
      planId: `ewa_${version}`,
      targetEventSchemaVersion: version,
      eventDatabase: "copied",
      coordinate: "copied",
    }),
  );
}

function ports(selected: number): EventWriterBackupRetentionPorts {
  return { selectedSchemaVersion: async () => selected, now: () => NOW };
}

async function names(root: string): Promise<string[]> {
  return (await readdir(backups(root))).sort();
}

describe("event writer backup retention (ADR-0651)", () => {
  it("keeps only the rollback point and prunes every superseded backup", async () => {
    const root = await repository();
    await backup(root, 5, 60);
    await backup(root, 8, 30);
    await backup(root, 14, 10);
    await backup(root, 16, 1);

    const plan = await planEventWriterBackupRetention(root, ports(16));
    expect(plan).toMatchObject({
      disposition: "safe_apply",
      reason: "event_writer_backup_retention_ready",
      selectedSchemaVersion: 16,
      rollbackPoint: ".lervo/data/event-writer-backups/schema-16",
      gracePeriodDays: 0,
    });
    expect(plan.candidates.map((item) => item.name)).toEqual(["schema-5", "schema-8", "schema-14"]);
    expect(plan.reclaimableBytes).toBe(
      plan.candidates.reduce((total, item) => total + item.bytes, 0),
    );
    expect(plan.retained).toEqual([{ name: "schema-16", reason: "rollback_point" }]);
    const lines = eventWriterBackupRetentionLines(plan);
    expect(lines[0]).toContain("rollback point .lervo/data/event-writer-backups/schema-16");
    expect(lines.slice(1).map((line) => line.split(" (")[0])).toEqual([
      "  remove backup schema-5",
      "  remove backup schema-8",
      "  remove backup schema-14",
    ]);

    const outcome = await applyEventWriterBackupRetention(root, plan, ports(16));
    expect(outcome).toEqual({
      removed: ["schema-5", "schema-8", "schema-14"],
      reclaimedBytes: plan.reclaimableBytes,
    });
    expect(await names(root)).toEqual(["schema-16"]);
    expect((await planEventWriterBackupRetention(root, ports(16))).disposition).toBe("current");
  });

  it("keeps the current rollback point even when it is the only and oldest backup", async () => {
    const root = await repository();
    await backup(root, 16, 400);
    const plan = await planEventWriterBackupRetention(root, ports(16));
    expect(plan).toMatchObject({ disposition: "current", candidates: [] });
    expect(plan.retained).toEqual([{ name: "schema-16", reason: "rollback_point" }]);
  });

  it("keeps every backup when the rollback point is missing or invalid", async () => {
    const root = await repository();
    await backup(root, 5, 60);
    await backup(root, 8, 30);
    expect(await planEventWriterBackupRetention(root, ports(16))).toMatchObject({
      disposition: "deferred",
      reason: "event_writer_backup_rollback_point_unverified",
      candidates: [],
    });

    await backup(root, 16, 1);
    await writeFile(backups(root, "schema-16", "backup.json"), "{not json");
    expect(await planEventWriterBackupRetention(root, ports(16))).toMatchObject({
      reason: "event_writer_backup_rollback_point_unverified",
    });

    await backup(root, 16, 1);
    await rm(backups(root, "schema-16", "events.sqlite"));
    expect(await planEventWriterBackupRetention(root, ports(16))).toMatchObject({
      reason: "event_writer_backup_rollback_point_unverified",
    });

    const unchanged = await names(root);
    const deferred = await planEventWriterBackupRetention(root, ports(16));
    expect(await applyEventWriterBackupRetention(root, deferred, ports(16))).toEqual({
      removed: [],
      reclaimedBytes: 0,
    });
    expect(await names(root)).toEqual(unchanged);
  });

  it("keeps every backup after a rollback below a backup's version", async () => {
    const root = await repository();
    await backup(root, 5, 60);
    await backup(root, 14, 40);
    await backup(root, 16, 30);
    expect(await planEventWriterBackupRetention(root, ports(14))).toMatchObject({
      disposition: "deferred",
      reason: "event_writer_backup_rollback_observed",
      candidates: [],
    });
  });

  it("keeps every backup when the selected version cannot be read", async () => {
    const root = await repository();
    await backup(root, 5, 60);
    await backup(root, 16, 30);
    const plan = await planEventWriterBackupRetention(root, {
      selectedSchemaVersion: () => Promise.reject(new Error("pending transaction")),
      now: () => NOW,
    });
    expect(plan).toMatchObject({
      disposition: "deferred",
      reason: "event_writer_backup_coordinate_unavailable",
    });
  });

  it("never follows a symbolic link, at the root or for a backup", async () => {
    const outside = await repository();
    await backup(outside, 5, 60);

    const linkedBackup = await repository();
    await backup(linkedBackup, 16, 30);
    await symlink(backups(outside, "schema-5"), backups(linkedBackup, "schema-5"));
    const plan = await planEventWriterBackupRetention(linkedBackup, ports(16));
    expect(plan).toMatchObject({ disposition: "current", candidates: [] });

    const linkedRoot = await repository();
    await mkdir(resolve(linkedRoot, ".lervo/data"), { recursive: true });
    await symlink(backups(outside), backups(linkedRoot));
    expect(await planEventWriterBackupRetention(linkedRoot, ports(5))).toMatchObject({
      disposition: "deferred",
      reason: "event_writer_backup_root_unsafe",
    });

    // A backup holding a link is not Lervo's layout, so it is never removed.
    const linkedFile = await repository();
    await backup(linkedFile, 5, 60);
    await backup(linkedFile, 16, 30);
    await symlink(
      backups(outside, "schema-5", "event-contract.json"),
      backups(linkedFile, "schema-5", "outside.json"),
    );
    expect(await planEventWriterBackupRetention(linkedFile, ports(16))).toMatchObject({
      disposition: "current",
      retained: [
        { name: "schema-5", reason: "unverified" },
        { name: "schema-16", reason: "rollback_point" },
      ],
    });
    expect(await names(outside)).toEqual(["schema-5"]);
  });

  it("is current without a backup directory", async () => {
    const root = await repository();
    expect(await planEventWriterBackupRetention(root, ports(16))).toMatchObject({
      disposition: "current",
      reason: "event_writer_backup_retention_current",
      rollbackPoint: null,
    });
  });

  it("removes nothing a fresh plan no longer names, and finishes an interrupted removal", async () => {
    const root = await repository();
    await backup(root, 5, 60);
    await backup(root, 16, 30);
    const plan = await planEventWriterBackupRetention(root, ports(16));
    // An approval bound to another directory identity, as after the backup was replaced.
    const stale = {
      ...plan,
      candidates: plan.candidates.map((item) => ({ ...item, identity: "0:0" })),
    };
    expect((await applyEventWriterBackupRetention(root, stale, ports(16))).removed).toEqual([]);
    expect(await names(root)).toEqual(["schema-16", "schema-5"]);

    const leftover = ".retired-schema-8-00000000-0000-4000-8000-000000000000";
    await mkdir(backups(root, leftover));
    await writeFile(backups(root, leftover, "backup.json"), "{}");
    await mkdir(backups(root, ".preparing-activation"));
    const resumed = await planEventWriterBackupRetention(root, ports(16));
    expect(resumed.candidates.map((item) => [item.name, item.supersededAt])).toEqual([
      [leftover, null],
      ["schema-5", "2026-10-28T12:00:00.000Z"],
    ]);
    await applyEventWriterBackupRetention(root, resumed, ports(16));
    expect(await names(root)).toEqual([".preparing-activation", "schema-16"]);
  });

  it("returns a failed removal instead of throwing, and leaves the leftover for the next run", async () => {
    const root = await repository();
    await backup(root, 5, 60);
    await backup(root, 8, 30);
    await backup(root, 16, 1);
    await chmod(backups(root, "schema-5"), 0o500);
    try {
      const plan = await planEventWriterBackupRetention(root, ports(16));
      expect(await applyEventWriterBackupRetention(root, plan, ports(16))).toEqual({
        removed: [],
        reclaimedBytes: 0,
        failure: {
          code: "event_writer_backup_retention_failed",
          name: "schema-5",
          errorCode: "EACCES",
        },
      });
    } finally {
      for (const name of await names(root)) await chmod(backups(root, name), 0o700);
    }
    const leftover = (await names(root)).find((name) => name.startsWith(".retired-schema-5-"));
    expect(leftover).toBeDefined();
    expect(
      eventWriterBackupRetentionReceiptLines({
        removed: [],
        reclaimedBytes: 0,
        failure: {
          code: "event_writer_backup_retention_failed",
          name: "schema-5",
          errorCode: "EACCES",
        },
      }),
    ).toEqual([
      "event writer backup removal failed: schema-5 (EACCES); held as Lervo debt (event_writer_backup_retention_failed) and retried by the next upgrade",
    ]);
    // With no grace period, the next run also removes schema-8, which schema-16 superseded.
    const resumed = await planEventWriterBackupRetention(root, ports(16));
    expect(resumed.candidates.map((item) => item.name)).toEqual([leftover, "schema-8"]);
    expect((await applyEventWriterBackupRetention(root, resumed, ports(16))).removed).toEqual([
      leftover,
      "schema-8",
    ]);
  });
});
