import {
  readOwnerOnlyFile as readSecureFile,
  readOwnerOnlyText as readSecureText,
  RuntimeSecurityError,
} from "@lervo/runtime-security";

import { HubRuntimeError } from "./errors.js";

export async function readOwnerOnlyFile(path: string, maximumBytes: number): Promise<Buffer> {
  try {
    return await readSecureFile(path, maximumBytes);
  } catch (error) {
    throw new HubRuntimeError(
      "unsafe_runtime_file",
      "Hub runtime 보안 파일을 안전하게 읽지 못했습니다.",
      { cause: error },
    );
  }
}

export async function readOwnerOnlyText(path: string, maximumBytes: number): Promise<string> {
  try {
    return await readSecureText(path, maximumBytes);
  } catch (error) {
    if (error instanceof RuntimeSecurityError && error.code !== "invalid_text") {
      throw new HubRuntimeError(
        "unsafe_runtime_file",
        "Hub runtime 보안 파일을 안전하게 읽지 못했습니다.",
        { cause: error },
      );
    }
    throw new HubRuntimeError(
      "invalid_config",
      "Hub runtime 보안 파일은 올바른 UTF-8이어야 합니다.",
      { cause: error },
    );
  }
}
