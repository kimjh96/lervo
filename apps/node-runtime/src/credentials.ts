import { readOwnerOnlyText, RuntimeSecurityError } from "@lervo/runtime-security";

import { NodeRuntimeError } from "./errors.js";

const MAX_BEARER_TOKEN_FILE_BYTES = 4_098;

function normalizedToken(value: string): string {
  const token = value.endsWith("\r\n") ? value.slice(0, -2) :
    value.endsWith("\n") ? value.slice(0, -1) : value;
  if (
    token.length < 32 || token.length > 4_096 ||
    !/^[\x21-\x7e]+$/.test(token)
  ) throw new NodeRuntimeError("invalid_config", "The Hub bearer token file is invalid.");
  return token;
}

export async function loadNodeBearerToken(path: string): Promise<string> {
  let tokenText: string;
  try {
    tokenText = await readOwnerOnlyText(path, MAX_BEARER_TOKEN_FILE_BYTES);
  } catch (error) {
    const code = error instanceof RuntimeSecurityError && error.code === "invalid_text"
      ? "invalid_config"
      : "unsafe_runtime_file";
    throw new NodeRuntimeError(code, "Could not read the Hub bearer token file safely.", {
      cause: error,
    });
  }
  return normalizedToken(tokenText);
}

export class ReloadableNodeBearerToken {
  private token: string;

  constructor(token: string) {
    this.token = normalizedToken(token);
  }

  current(): string {
    return this.token;
  }

  replace(token: string): void {
    this.token = normalizedToken(token);
  }
}
