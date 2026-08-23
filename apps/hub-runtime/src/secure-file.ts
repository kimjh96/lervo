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
      "Could not read the Hub runtime secure file safely.",
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
        "Could not read the Hub runtime secure file safely.",
        { cause: error },
      );
    }
    throw new HubRuntimeError(
      "invalid_config",
      "The Hub runtime secure file must contain valid UTF-8.",
      { cause: error },
    );
  }
}
