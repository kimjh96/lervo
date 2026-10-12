import { createHash, randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { EventStoreError } from "../src/errors.js";
import { decodeReport, captureReport, type EncodedReport } from "../src/report-codec.js";

function roundTrip(report: EncodedReport): Uint8Array {
  return decodeReport(report.header, report.chunks);
}

function expectCorrupt(report: EncodedReport): void {
  expect(() => roundTrip(report)).toThrowError(expect.objectContaining({ code: "report_corrupt" }));
}

describe("private report codec", () => {
  it.each([1, 799, 800, 801, 1_048_576])("preserves all %i random bytes", (size) => {
    const bytes = randomBytes(size);
    const encoded = captureReport(bytes).encode();
    expect(encoded.header.contentHash).toBe(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
    expect(roundTrip(encoded)).toEqual(bytes);
    expect(encoded.chunks.every((chunk) => chunk.body.byteLength <= 800)).toBe(true);
  });

  it("owns input and each decoded result independently", () => {
    const input = Buffer.from("private report body");
    const encoded = captureReport(input).encode();
    input.fill(0);
    const first = roundTrip(encoded);
    first.fill(0);
    expect(Buffer.from(roundTrip(encoded)).toString()).toBe("private report body");
  });

  it.each([new Uint8Array(), new Uint8Array(1_048_577), new Uint8Array(new SharedArrayBuffer(8))])(
    "rejects empty, oversized and concurrently mutable inputs",
    (input) => {
      expect(() => captureReport(input).encode()).toThrowError(
        expect.objectContaining({ code: "invalid_report" }),
      );
    },
  );

  it("rejects missing, duplicate and reordered chunks", () => {
    const encoded = captureReport(randomBytes(4_096)).encode();
    expectCorrupt({ ...encoded, chunks: encoded.chunks.slice(1) });
    expectCorrupt({ ...encoded, chunks: [encoded.chunks[0]!, ...encoded.chunks] });
    expectCorrupt({ ...encoded, chunks: [...encoded.chunks].reverse() });
  });

  it("rejects changed bytes, ordinals and chunk sizes", () => {
    const encoded = captureReport(randomBytes(4_096)).encode();
    for (const change of [
      { part: 1, body: encoded.chunks[0]!.body },
      { part: 0, body: new Uint8Array(799) },
      { part: 0, body: new Uint8Array(800) },
      { part: 0, body: new Uint8Array(801) },
    ]) {
      expectCorrupt({ ...encoded, chunks: [change, ...encoded.chunks.slice(1)] });
    }
  });

  it("rejects invalid metadata and a valid but conflicting hash", () => {
    const encoded = captureReport(Buffer.from("report")).encode();
    for (const change of [
      { byteCount: 0 },
      { byteCount: 1_048_577 },
      { byteCount: 1.5 },
      { encodedByteCount: 0 },
      { encodedByteCount: 1_049_601 },
      { chunkCount: 0 },
      { chunkCount: 1_313 },
      { contentHash: "sha256:" + "0".repeat(64) },
    ]) {
      expectCorrupt({ ...encoded, header: { ...encoded.header, ...change } });
    }
  });

  it("bounds decompression by declared original length and masks native errors", () => {
    const encoded = captureReport(Buffer.alloc(1_048_576, 97)).encode();
    expectCorrupt({ ...encoded, header: { ...encoded.header, byteCount: 16 } });
    try {
      roundTrip({ ...encoded, chunks: [] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EventStoreError);
      expect((error as Error).message).toBe("The stored report is invalid or incomplete.");
    }
  });

  it("rejects truncated streams and mismatched uncompressed lengths", () => {
    const encoded = captureReport(Buffer.from("complete private report")).encode();
    const bytes = deflateRawSync(Buffer.from("complete private report"));
    expectCorrupt({
      header: { ...encoded.header, encodedByteCount: bytes.length - 1 },
      chunks: [{ part: 0, body: bytes.subarray(0, -1) }],
    });
    expectCorrupt({ ...encoded, header: { ...encoded.header, byteCount: 100 } });
  });
  it("rejects trailing bytes and concatenated compressed streams", () => {
    const encoded = captureReport(Buffer.from("report")).encode();
    const compressed = Buffer.from(encoded.chunks[0]!.body);
    for (const suffix of [Buffer.from([0]), deflateRawSync(Buffer.from("extra"))]) {
      const body = Buffer.concat([compressed, suffix]);
      expectCorrupt({
        header: { ...encoded.header, encodedByteCount: body.length },
        chunks: [{ part: 0, body }],
      });
    }
  });
});
