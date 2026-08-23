import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

import { RuntimeSecurityError } from "./errors.js";

const utf8 = new TextDecoder("utf-8", { fatal: true });

export async function readOwnerOnlyFile(path: string, maximumBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RuntimeSecurityError("unsafe_file", "The secure-file size limit is invalid.");
  }
  const absolutePath = resolve(path);
  let handle;
  try {
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 ||
      before.size > maximumBytes ||
      (process.platform !== "win32" && (before.mode & 0o077) !== 0)) {
      throw new RuntimeSecurityError(
        "unsafe_file",
        "A secure file must be a regular file within the size limit and readable only by its owner.",
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      bytes.byteLength !== before.size || after.size !== before.size ||
      after.dev !== before.dev || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs
    ) {
      bytes.fill(0);
      throw new RuntimeSecurityError("unsafe_file", "The secure file changed while it was being read.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof RuntimeSecurityError) throw error;
    throw new RuntimeSecurityError("unsafe_file", "The secure file could not be read safely.", {
      cause: error,
    });
  } finally {
    await handle?.close();
  }
}

export async function readOwnerOnlyText(path: string, maximumBytes: number): Promise<string> {
  const bytes = await readOwnerOnlyFile(path, maximumBytes);
  try {
    const value = utf8.decode(bytes);
    if (value.includes("\0")) throw new Error("NUL byte");
    return value;
  } catch (error) {
    throw new RuntimeSecurityError("invalid_text", "A secure file must contain valid UTF-8.", {
      cause: error,
    });
  } finally {
    bytes.fill(0);
  }
}
