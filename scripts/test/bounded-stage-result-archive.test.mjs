import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  maximumStageResultRecordBytes,
  readBoundedStageResultArchive,
} from "../lib/bounded-stage-result-archive.mjs";
import { sha256 } from "../lib/release-artifact-manifest.mjs";
import { createStageResultArchive } from
  "./fixtures/first-publication-stage-result.mjs";
import { createZipArchive } from "./fixtures/zip-archive.mjs";

describe("bounded stage result artifact archive", () => {
  it("reads exact canonical records with and without ZIP data descriptors", () => {
    for (const descriptor of [false, true]) {
      const fixture = createStageResultArchive({ descriptor });
      const result = readBoundedStageResultArchive(
        fixture.archiveContents,
        sha256(fixture.archiveContents),
      );
      assert.equal(result.attempt.state, "reserved");
      assert.equal(result.terminal.state, "staged");
      assert.equal(result.archive.byteCount, fixture.archiveContents.length);
    }
  });

  it("rejects digest mismatch, unexpected paths, duplicates, and noncanonical JSON", () => {
    const valid = createStageResultArchive();
    assert.throws(
      () => readBoundedStageResultArchive(
        valid.archiveContents,
        `sha256:${"f".repeat(64)}`,
      ),
      { code: "first_publication_stage_result_archive_digest_mismatch" },
    );
    for (const archive of [
      createStageResultArchive({
        entryNames: ["attempt.json", "../terminal.json"],
      }).archiveContents,
      createStageResultArchive({
        entryNames: ["attempt.json", "attempt.json"],
      }).archiveContents,
      createZipArchive([
        ["attempt.json", "{}"],
        ["terminal.json", "{}\n"],
      ]),
    ]) {
      assert.throws(
        () => readBoundedStageResultArchive(archive, sha256(archive)),
        { code: "first_publication_stage_result_archive_invalid" },
      );
    }
  });

  it("rejects oversized declarations and corrupt compressed data", () => {
    const oversized = Buffer.from(createStageResultArchive().archiveContents);
    const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    oversized.writeUInt32LE(maximumStageResultRecordBytes + 1, central + 24);
    assert.throws(
      () => readBoundedStageResultArchive(oversized, sha256(oversized)),
      { code: "first_publication_stage_result_archive_invalid" },
    );

    const corrupt = Buffer.from(createStageResultArchive({ descriptor: false }).archiveContents);
    const nameLength = corrupt.readUInt16LE(26);
    corrupt[30 + nameLength] ^= 0xff;
    assert.throws(
      () => readBoundedStageResultArchive(corrupt, sha256(corrupt)),
      { code: "first_publication_stage_result_archive_invalid" },
    );

    const symlink = Buffer.from(createStageResultArchive().archiveContents);
    const symlinkCentral = symlink.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    symlink.writeUInt32LE((0o120777 << 16) >>> 0, symlinkCentral + 38);
    assert.throws(
      () => readBoundedStageResultArchive(symlink, sha256(symlink)),
      { code: "first_publication_stage_result_archive_invalid" },
    );

    const overlap = Buffer.from(createStageResultArchive().archiveContents);
    const firstCentral = overlap.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const firstCentralLength = 46 + overlap.readUInt16LE(firstCentral + 28) +
      overlap.readUInt16LE(firstCentral + 30) + overlap.readUInt16LE(firstCentral + 32);
    const secondCentral = firstCentral + firstCentralLength;
    overlap.writeUInt32LE(0, secondCentral + 42);
    assert.throws(
      () => readBoundedStageResultArchive(overlap, sha256(overlap)),
      { code: "first_publication_stage_result_archive_invalid" },
    );
  });
});
