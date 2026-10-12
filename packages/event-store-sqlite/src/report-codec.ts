import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import { EventStoreError } from "./errors.js";

const maximumReportBytes = 1_048_576;
const maximumEncodedBytes = maximumReportBytes + 1_024;
const chunkBytes = 800;
const maximumChunks = Math.ceil(maximumEncodedBytes / chunkBytes);
const hashPattern = /^sha256:[a-f0-9]{64}$/u;

export interface ReportHeader {
  codec: "deflate_raw_v1";
  contentHash: string;
  byteCount: number;
  encodedByteCount: number;
  chunkCount: number;
}

export interface ReportChunk {
  part: number;
  body: Uint8Array;
}

export interface EncodedReport {
  header: Readonly<ReportHeader>;
  chunks: readonly ReportChunk[];
}

function contentHash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function corrupt(): never {
  throw new EventStoreError("report_corrupt", "The stored report is invalid or incomplete.");
}

/** Capture private bytes and identity before lookup; compression is needed only for new content. */
export function captureReport(content: Uint8Array) {
  if (
    !(content instanceof Uint8Array) ||
    content.byteLength < 1 ||
    content.byteLength > maximumReportBytes ||
    content.buffer instanceof SharedArrayBuffer
  )
    throw new EventStoreError("invalid_report", "The report must contain bounded private bytes.");
  const bytes = Buffer.from(content);
  const hash = contentHash(bytes);
  return Object.freeze({
    contentHash: hash,
    byteCount: bytes.byteLength,
    encode: () => encodeCapturedReport(bytes, hash),
  });
}

function encodeCapturedReport(bytes: Buffer, hash: string): EncodedReport {
  const encoded = deflateRawSync(bytes, { level: 1 });
  if (encoded.byteLength > maximumEncodedBytes)
    throw new EventStoreError("invalid_report", "The encoded report exceeds its size bound.");
  const chunks: ReportChunk[] = [];
  for (let offset = 0; offset < encoded.byteLength; offset += chunkBytes) {
    chunks.push({ part: chunks.length, body: encoded.subarray(offset, offset + chunkBytes) });
  }
  return {
    header: Object.freeze({
      codec: "deflate_raw_v1",
      contentHash: hash,
      byteCount: bytes.byteLength,
      encodedByteCount: encoded.byteLength,
      chunkCount: chunks.length,
    }),
    chunks,
  };
}

/** Validate bounded database rows before allocating or decompressing their contents. */
export function decodeReport(header: ReportHeader, chunks: readonly ReportChunk[]): Uint8Array {
  if (
    header.codec !== "deflate_raw_v1" ||
    typeof header.contentHash !== "string" ||
    !hashPattern.test(header.contentHash) ||
    !Number.isSafeInteger(header.byteCount) ||
    header.byteCount < 1 ||
    header.byteCount > maximumReportBytes ||
    !Number.isSafeInteger(header.encodedByteCount) ||
    header.encodedByteCount < 1 ||
    header.encodedByteCount > maximumEncodedBytes ||
    !Number.isSafeInteger(header.chunkCount) ||
    header.chunkCount < 1 ||
    header.chunkCount > maximumChunks ||
    header.chunkCount !== Math.ceil(header.encodedByteCount / chunkBytes) ||
    chunks.length !== header.chunkCount
  )
    corrupt();
  const buffers: Buffer[] = [];
  let remaining = header.encodedByteCount;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]!;
    const expectedBytes = Math.min(chunkBytes, remaining);
    if (
      chunk.part !== index ||
      !(chunk.body instanceof Uint8Array) ||
      chunk.body.buffer instanceof SharedArrayBuffer ||
      chunk.body.byteLength !== expectedBytes
    )
      corrupt();
    buffers.push(Buffer.from(chunk.body));
    remaining -= expectedBytes;
  }
  let bytes: Buffer;
  try {
    const inflated: unknown = inflateRawSync(Buffer.concat(buffers, header.encodedByteCount), {
      maxOutputLength: header.byteCount,
      info: true,
    });
    if (
      inflated === null ||
      typeof inflated !== "object" ||
      !("buffer" in inflated) ||
      !Buffer.isBuffer(inflated.buffer) ||
      !("engine" in inflated) ||
      inflated.engine === null ||
      typeof inflated.engine !== "object" ||
      !("bytesWritten" in inflated.engine) ||
      inflated.engine.bytesWritten !== header.encodedByteCount
    )
      corrupt();
    bytes = inflated.buffer;
  } catch {
    corrupt();
  }
  if (bytes.byteLength !== header.byteCount || contentHash(bytes) !== header.contentHash) corrupt();
  return bytes;
}
