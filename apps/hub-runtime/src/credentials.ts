import { ConfiguredBearerAuthenticator, type HubBearerCredential } from "@lervo/hub";
import { readOwnerOnlyText, RuntimeSecurityError } from "@lervo/runtime-security";

import { MAX_CREDENTIALS_FILE_BYTES, parseHubBearerCredentials } from "./config.js";
import type { HubRuntimeConfig } from "./config-types.js";
import { HubRuntimeError } from "./errors.js";

function parseCredentialFile(serialized: string): HubBearerCredential[] {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new HubRuntimeError("invalid_config", "The Hub credential file is not valid JSON.", {
      cause: error,
    });
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "schemaVersion" && key !== "credentials") ||
    (value as Record<string, unknown>).schemaVersion !== 1
  ) {
    throw new HubRuntimeError("invalid_config", "The Hub credential file contract is invalid.");
  }
  return parseHubBearerCredentials((value as Record<string, unknown>).credentials);
}

export async function loadHubRuntimeCredentials(
  config: HubRuntimeConfig,
): Promise<HubBearerCredential[]> {
  if (config.credentials !== undefined) return structuredClone(config.credentials);
  if (config.credentialsFile === undefined) {
    throw new HubRuntimeError("invalid_config", "No Hub credential source was provided.");
  }
  let serialized: string;
  try {
    serialized = await readOwnerOnlyText(config.credentialsFile, MAX_CREDENTIALS_FILE_BYTES);
  } catch (error) {
    const code =
      error instanceof RuntimeSecurityError && error.code === "invalid_text"
        ? "invalid_config"
        : "unsafe_runtime_file";
    throw new HubRuntimeError(code, "Could not read the Hub credential file safely.", {
      cause: error,
    });
  }
  const credentials = parseCredentialFile(serialized);
  try {
    new ConfiguredBearerAuthenticator(credentials);
  } catch (error) {
    throw new HubRuntimeError("invalid_config", "A Hub runtime credential is invalid.", {
      cause: error,
    });
  }
  return credentials;
}
