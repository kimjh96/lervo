import { inflateRawSync } from "node:zlib";

import { parseCanonicalReleaseJson } from "./bounded-release-json-source.mjs";
import { FirstPublicationBootstrapError } from "../first-publication/transition/first-publication-bootstrap.mjs";
import { sha256 } from "../../shared/release-artifact-manifest.mjs";

export const maximumStageResultArchiveBytes = 1024 * 1024;
export const maximumStageResultRecordBytes = 128 * 1024;
export const stageResultEntryNames = Object.freeze(["attempt.json", "terminal.json"]);

const localSignature = 0x04034b50;
const centralSignature = 0x02014b50;
const endSignature = 0x06054b50;
const maximumEndSearchBytes = 65_557;
const allowedFlags = 0x0808;

function fail(code = "first_publication_stage_result_archive_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI npm stage-result artifact archive is invalid.",
  );
}

function uint16(contents, offset) {
  if (offset < 0 || offset + 2 > contents.length) fail();
  return contents.readUInt16LE(offset);
}

function uint32(contents, offset) {
  if (offset < 0 || offset + 4 > contents.length) fail();
  return contents.readUInt32LE(offset);
}

function decodeName(contents) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    fail();
  }
}

function findEndRecord(contents) {
  const start = Math.max(0, contents.length - maximumEndSearchBytes);
  for (let offset = contents.length - 22; offset >= start; offset -= 1) {
    if (uint32(contents, offset) !== endSignature) continue;
    const commentLength = uint16(contents, offset + 20);
    if (offset + 22 + commentLength === contents.length) return offset;
  }
  fail();
}

function readCentralDirectory(contents) {
  const endOffset = findEndRecord(contents);
  if (
    uint16(contents, endOffset + 4) !== 0 ||
    uint16(contents, endOffset + 6) !== 0 ||
    uint16(contents, endOffset + 8) !== stageResultEntryNames.length ||
    uint16(contents, endOffset + 10) !== stageResultEntryNames.length ||
    uint16(contents, endOffset + 20) !== 0
  )
    fail();
  const centralSize = uint32(contents, endOffset + 12);
  const centralOffset = uint32(contents, endOffset + 16);
  if (
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    centralOffset + centralSize !== endOffset
  )
    fail();
  const entries = [];
  let offset = centralOffset;
  while (offset < endOffset) {
    if (uint32(contents, offset) !== centralSignature || offset + 46 > endOffset) fail();
    const flags = uint16(contents, offset + 8);
    const method = uint16(contents, offset + 10);
    const crc = uint32(contents, offset + 16);
    const compressedSize = uint32(contents, offset + 20);
    const uncompressedSize = uint32(contents, offset + 24);
    const nameLength = uint16(contents, offset + 28);
    const extraLength = uint16(contents, offset + 30);
    const commentLength = uint16(contents, offset + 32);
    const disk = uint16(contents, offset + 34);
    const externalAttributes = uint32(contents, offset + 38);
    const localOffset = uint32(contents, offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (
      next > endOffset ||
      nameLength === 0 ||
      (flags & ~allowedFlags) !== 0 ||
      ![0, 8].includes(method) ||
      disk !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      uncompressedSize <= 0 ||
      uncompressedSize > maximumStageResultRecordBytes ||
      localOffset === 0xffffffff
    )
      fail();
    const name = decodeName(contents.subarray(offset + 46, offset + 46 + nameLength));
    const unixMode = externalAttributes >>> 16;
    const fileType = unixMode & 0o170000;
    if (
      !stageResultEntryNames.includes(name) ||
      name.includes("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      (fileType !== 0 && fileType !== 0o100000)
    )
      fail();
    entries.push({
      name,
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset = next;
  }
  if (
    offset !== endOffset ||
    entries.length !== stageResultEntryNames.length ||
    new Set(entries.map(({ name }) => name)).size !== entries.length
  )
    fail();
  return { entries, centralOffset };
}

function crc32(contents) {
  let crc = 0xffffffff;
  for (const byte of contents) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readEntry(contents, entry, centralOffset) {
  const offset = entry.localOffset;
  if (uint32(contents, offset) !== localSignature || offset + 30 > centralOffset) fail();
  const flags = uint16(contents, offset + 6);
  const method = uint16(contents, offset + 8);
  const localCrc = uint32(contents, offset + 14);
  const localCompressedSize = uint32(contents, offset + 18);
  const localUncompressedSize = uint32(contents, offset + 22);
  const nameLength = uint16(contents, offset + 26);
  const extraLength = uint16(contents, offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (
    flags !== entry.flags ||
    method !== entry.method ||
    dataEnd > centralOffset ||
    decodeName(contents.subarray(offset + 30, offset + 30 + nameLength)) !== entry.name ||
    ((flags & 0x0008) === 0 &&
      (localCrc !== entry.crc ||
        localCompressedSize !== entry.compressedSize ||
        localUncompressedSize !== entry.uncompressedSize))
  )
    fail();
  const compressed = contents.subarray(dataOffset, dataEnd);
  let output;
  try {
    output =
      method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: maximumStageResultRecordBytes });
  } catch {
    fail();
  }
  if (output.length !== entry.uncompressedSize || crc32(output) !== entry.crc) fail();
  let recordEnd = dataEnd;
  if ((flags & 0x0008) !== 0) {
    const hasSignature = uint32(contents, dataEnd) === 0x08074b50;
    const descriptorOffset = dataEnd + (hasSignature ? 4 : 0);
    if (
      descriptorOffset + 12 > centralOffset ||
      uint32(contents, descriptorOffset) !== entry.crc ||
      uint32(contents, descriptorOffset + 4) !== entry.compressedSize ||
      uint32(contents, descriptorOffset + 8) !== entry.uncompressedSize
    )
      fail();
    recordEnd = descriptorOffset + 12;
  }
  return { output, recordEnd };
}

export function readBoundedStageResultArchive(contents, expectedDigest) {
  if (
    !Buffer.isBuffer(contents) ||
    contents.length <= 0 ||
    contents.length > maximumStageResultArchiveBytes ||
    !/^sha256:[a-f0-9]{64}$/u.test(expectedDigest ?? "") ||
    sha256(contents) !== expectedDigest
  )
    fail("first_publication_stage_result_archive_digest_mismatch");
  const { entries, centralOffset } = readCentralDirectory(contents);
  const ranges = [];
  const documents = new Map();
  for (const entry of entries) {
    const { output, recordEnd } = readEntry(contents, entry, centralOffset);
    ranges.push([entry.localOffset, recordEnd]);
    let document;
    try {
      document = parseCanonicalReleaseJson(output);
    } catch {
      fail();
    }
    documents.set(entry.name, document);
  }
  ranges.sort(([left], [right]) => left - right);
  if (
    ranges[0][0] !== 0 ||
    ranges.at(-1)[1] !== centralOffset ||
    ranges.some((range, index) => index > 0 && range[0] !== ranges[index - 1][1])
  )
    fail();
  return {
    archive: { byteCount: contents.length, sha256: expectedDigest },
    attempt: documents.get("attempt.json"),
    terminal: documents.get("terminal.json"),
  };
}
