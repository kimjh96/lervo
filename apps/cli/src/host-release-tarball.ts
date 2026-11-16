import { gunzipSync } from "node:zlib";

const blockSize = 512;
const packagePrefix = "package/";
const maximumUnpackedBytes = 256 * 1024 * 1024;

export class NpmTarballError extends Error {
  readonly code = "npm_tarball_invalid";
  constructor() {
    super("The npm package tarball is invalid.");
    this.name = "NpmTarballError";
  }
}

function fail(): never {
  throw new NpmTarballError();
}

function field(header: Buffer, offset: number, length: number): string {
  const bytes = header.subarray(offset, offset + length);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? length : end).toString("utf8");
}

function octal(header: Buffer, offset: number, length: number): number {
  const text = field(header, offset, length).trim();
  if (!/^[0-7]+$/u.test(text)) fail();
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) fail();
  return value;
}

function checksumValid(header: Buffer): boolean {
  let sum = 0;
  for (let index = 0; index < blockSize; index += 1)
    sum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  return sum === octal(header, 148, 8);
}

/** Reads the `path` record of a POSIX pax extended header, the only record npm packers emit. */
function paxPath(contents: Buffer): string | undefined {
  let offset = 0;
  let path: string | undefined;
  while (offset < contents.length) {
    const space = contents.indexOf(0x20, offset);
    if (space === -1) fail();
    const length = Number.parseInt(contents.subarray(offset, space).toString("utf8"), 10);
    if (!Number.isSafeInteger(length) || length <= space - offset + 1) fail();
    if (contents[offset + length - 1] !== 0x0a) fail();
    const record = contents.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals === -1) fail();
    if (record.slice(0, equals) === "path") path = record.slice(equals + 1);
    offset += length;
  }
  return path;
}

function packageRelativePath(path: string): string {
  if (!path.startsWith(packagePrefix)) fail();
  const relative = path.slice(packagePrefix.length);
  const segments = relative.split("/");
  if (
    relative.length === 0 ||
    relative.includes("\\") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  )
    fail();
  return relative;
}

/**
 * Lists the regular files of an npm package tarball by package-relative path, without writing to
 * disk. Links, devices, duplicate paths, and paths outside `package/` are rejected, because an
 * installed release must contain only the files its manifest names. This is the host-side copy of
 * `scripts/release/lib/npm-tarball-entries.mjs`: publication verifies before any build, so it
 * cannot import this bundled module, and the CLI bundle cannot import repository scripts.
 */
export function readNpmTarballEntries(gzipContents: Buffer): Map<string, Buffer> {
  let archive: Buffer;
  try {
    archive = gunzipSync(gzipContents, { maxOutputLength: maximumUnpackedBytes });
  } catch {
    fail();
  }
  const entries = new Map<string, Buffer>();
  let offset = 0;
  let pendingPath: string | undefined;
  while (offset + blockSize <= archive.length) {
    const header = archive.subarray(offset, offset + blockSize);
    if (header.every((byte) => byte === 0)) return entries;
    if (!field(header, 257, 6).startsWith("ustar") || !checksumValid(header)) fail();
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + blockSize;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) fail();
    const data = archive.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / blockSize) * blockSize;
    if (type === "x") {
      pendingPath = paxPath(data);
      continue;
    }
    if (type === "g") continue;
    const prefix = field(header, 345, 155);
    const name = field(header, 0, 100);
    const path = pendingPath ?? (prefix ? `${prefix}/${name}` : name);
    pendingPath = undefined;
    if (type === "5") continue;
    if (type !== "0" && type !== "\0") fail();
    const relative = packageRelativePath(path);
    if (entries.has(relative)) fail();
    entries.set(relative, Buffer.from(data));
  }
  fail();
}
