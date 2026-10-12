import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { readEntry, type FileSystemEntry } from "./filesystem.js";

const maximumSynchronousBytes = 64 * 1024;

/** Fresh small metadata reads avoid thread-pool round trips; larger inputs retain async I/O. */
export async function readSmallEntry(
  path: string,
  maximumFileBytes = 4 * 1024 * 1024,
): Promise<FileSystemEntry> {
  let initial;
  try {
    initial = lstatSync(path, { bigint: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { kind: "missing" };
    if (code === "ENOTDIR")
      return { kind: "unsupported", description: "entry whose parent path is not a directory" };
    throw error;
  }
  if (initial.isSymbolicLink()) return { kind: "unsupported", description: "symbolic link" };
  if (initial.isDirectory()) return { kind: "directory" };
  if (!initial.isFile())
    return {
      kind: "unsupported",
      description: "entry that is neither a regular file nor a directory",
    };
  if (initial.size > BigInt(maximumFileBytes))
    return { kind: "unsupported", description: "file exceeding the size limit" };
  if (initial.size > BigInt(maximumSynchronousBytes)) return readEntry(path, maximumFileBytes);

  let descriptor: number | undefined;
  let verifier: number | undefined;
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  try {
    // NONBLOCK also prevents a replaced FIFO from blocking before fstat rejects it.
    descriptor = openSync(path, flags);
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      opened.size > BigInt(Math.min(maximumFileBytes, maximumSynchronousBytes))
    )
      return { kind: "unsupported", description: "file path changed before reading" };
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (
      !after.isFile() ||
      opened.dev !== after.dev ||
      opened.ino !== after.ino ||
      opened.size !== after.size ||
      opened.mtimeNs !== after.mtimeNs ||
      opened.ctimeNs !== after.ctimeNs ||
      BigInt(length) !== after.size
    )
      return { kind: "unsupported", description: "file changed while being read" };
    const pathAfter = lstatSync(path, { bigint: true });
    if (pathAfter.isSymbolicLink() || !pathAfter.isFile())
      return { kind: "unsupported", description: "file path changed after reading" };
    verifier = openSync(path, flags);
    const verified = fstatSync(verifier, { bigint: true });
    if (
      !verified.isFile() ||
      opened.dev !== verified.dev ||
      opened.ino !== verified.ino ||
      after.size !== verified.size ||
      after.mtimeNs !== verified.mtimeNs ||
      after.ctimeNs !== verified.ctimeNs
    )
      return { kind: "unsupported", description: "file path changed after reading" };
    try {
      return {
        kind: "file",
        content: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)),
      };
    } catch {
      return { kind: "unsupported", description: "file that is not valid UTF-8" };
    }
  } catch {
    return { kind: "unsupported", description: "file that cannot be opened safely" };
  } finally {
    try {
      if (verifier !== undefined) closeSync(verifier);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}
