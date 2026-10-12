import { type DatabaseSync } from "node:sqlite";
import { type ArtifactPutResult } from "@lervo/storage-contract";

import { EventStoreError } from "./errors.js";
import {
  captureReport,
  decodeReport,
  type ReportChunk,
  type ReportHeader,
} from "./report-codec.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";
import { preparedStatement } from "./statement-cache.js";

const maximumStoredBytes = 64 * 1_048_576;
const maximumReports = 16_384;
const hashPattern = /^sha256:[a-f0-9]{64}$/u;

function corrupt(): never {
  throw new EventStoreError("report_corrupt", "The stored report is invalid or incomplete.");
}

/** Private adapter; the event-store owner supplies connection and transaction lifetime checks. */
export class SQLiteReportRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly assertReadable: () => void,
    private readonly assertWritableTransaction: () => void,
  ) {}

  get(hash: string): Uint8Array | null {
    this.assertReadable();
    if (!hashPattern.test(hash))
      throw new EventStoreError("invalid_report", "The report hash is invalid.");
    const row = sqliteRow(
      preparedStatement(
        this.database,
        "SELECT substr(codec, 1, 32) AS codec, byte_count, encoded_byte_count, chunk_count FROM quality_reports WHERE hash = ?",
      ).get(hash),
    );
    if (row === undefined) {
      if (
        preparedStatement(
          this.database,
          "SELECT 1 FROM quality_report_chunks WHERE hash = ? LIMIT 1",
        ).get(hash)
      )
        corrupt();
      return null;
    }
    if (
      row.codec !== "deflate_raw_v1" ||
      typeof row.byte_count !== "number" ||
      typeof row.encoded_byte_count !== "number" ||
      typeof row.chunk_count !== "number"
    )
      corrupt();
    const header: ReportHeader = {
      codec: row.codec,
      contentHash: hash,
      byteCount: row.byte_count,
      encodedByteCount: row.encoded_byte_count,
      chunkCount: row.chunk_count,
    };
    const rows = sqliteRows(
      preparedStatement(
        this.database,
        "SELECT part, length(body) AS body_bytes, substr(body, 1, 800) AS body FROM quality_report_chunks WHERE hash = ? ORDER BY part LIMIT 1313",
      ).all(hash),
    );
    const chunks: ReportChunk[] = rows.map((chunk) => {
      if (
        typeof chunk.part !== "number" ||
        typeof chunk.body_bytes !== "number" ||
        !(chunk.body instanceof Uint8Array) ||
        chunk.body_bytes !== chunk.body.byteLength
      )
        corrupt();
      return { part: chunk.part, body: chunk.body };
    });
    return decodeReport(header, chunks);
  }

  insert(content: Uint8Array): ArtifactPutResult {
    this.assertWritableTransaction();
    const captured = captureReport(content);
    const { contentHash, byteCount } = captured;
    const uri = `lervo-cas://sha256/${contentHash.slice(7)}`;
    if (this.get(contentHash) !== null) return { uri, contentHash, byteCount, created: false };
    const report = captured.encode();
    const { encodedByteCount, chunkCount, codec } = report.header;
    const usage = sqliteRow(
      preparedStatement(
        this.database,
        `SELECT count(*) AS objects, coalesce(sum(byte_count), 0) AS decoded,
           coalesce(sum(encoded_byte_count), 0) AS encoded
           FROM (SELECT byte_count, encoded_byte_count FROM quality_reports LIMIT 16385)`,
      ).get(),
    );
    if (
      usage === undefined ||
      typeof usage.objects !== "number" ||
      typeof usage.decoded !== "number" ||
      typeof usage.encoded !== "number" ||
      ![usage.objects, usage.decoded, usage.encoded].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    )
      corrupt();
    if (
      usage.objects >= maximumReports ||
      usage.decoded + byteCount > maximumStoredBytes ||
      usage.encoded + encodedByteCount > maximumStoredBytes
    )
      throw new EventStoreError("report_capacity_exceeded", "The report store is at capacity.");
    preparedStatement(
      this.database,
      `INSERT INTO quality_reports(hash, codec, byte_count, encoded_byte_count, chunk_count)
         VALUES (?, ?, ?, ?, ?)`,
    ).run(contentHash, codec, byteCount, encodedByteCount, chunkCount);
    const insert = preparedStatement(
      this.database,
      "INSERT INTO quality_report_chunks(hash, part, body) VALUES (?, ?, ?)",
    );
    for (const chunk of report.chunks) insert.run(contentHash, chunk.part, chunk.body);
    if (this.get(contentHash) === null) corrupt();
    return { uri, contentHash, byteCount, created: true };
  }
}
