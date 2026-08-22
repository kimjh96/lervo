import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

import { HubRuntimeError } from "./errors.js";

const utf8 = new TextDecoder("utf-8", { fatal: true });

export async function readOwnerOnlyFile(path: string, maximumBytes: number): Promise<Buffer> {
  const absolutePath = resolve(path);
  let handle;
  try {
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 ||
      metadata.size > maximumBytes ||
      (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)) {
      throw new HubRuntimeError(
        "unsafe_runtime_file",
        "Hub runtime 보안 파일은 owner만 읽을 수 있는 크기 제한 내 일반 파일이어야 합니다.",
      );
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength !== metadata.size) {
      throw new HubRuntimeError("unsafe_runtime_file", "Hub runtime 보안 파일이 읽는 중 변경됐습니다.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof HubRuntimeError) throw error;
    throw new HubRuntimeError(
      "unsafe_runtime_file",
      "Hub runtime 보안 파일을 안전하게 읽지 못했습니다.",
      { cause: error },
    );
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
    throw new HubRuntimeError(
      "invalid_config",
      "Hub runtime 보안 파일은 올바른 UTF-8이어야 합니다.",
      { cause: error },
    );
  } finally {
    bytes.fill(0);
  }
}
