import { resolve } from "node:path";

import type { RuntimeCredentialSource } from "@lervo/organization-deployment-contract";
import { readOwnerOnlyFile } from "@lervo/runtime-security";

const CREDENTIAL_ID_PATTERN = /^ocg_[a-f0-9]{64}$/u;
const MAX_BINDINGS = 256;
const MAX_FILE_BYTES = 4_098;
const MAX_PATH_BYTES = 4_096;

export type OwnerOnlyFileCredentialSourceErrorCode =
  "invalid_source_config" | "credential_material_unavailable";

export class OwnerOnlyFileCredentialSourceError extends Error {
  constructor(
    readonly code: OwnerOnlyFileCredentialSourceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OwnerOnlyFileCredentialSourceError";
  }
}

export interface OwnerOnlyFileCredentialBinding {
  credentialId: string;
  filePath: string;
}

function normalizedPath(path: string): string {
  if (
    path.length === 0 ||
    Buffer.byteLength(path, "utf8") > MAX_PATH_BYTES ||
    path.includes("\0")
  ) {
    throw new OwnerOnlyFileCredentialSourceError(
      "invalid_source_config",
      "The owner-only credential source configuration is invalid.",
    );
  }
  return resolve(path);
}

function materialWithoutFinalNewline(bytes: Uint8Array): Uint8Array {
  let length = bytes.byteLength;
  if (length > 0 && bytes[length - 1] === 0x0a) {
    length -= 1;
    if (length > 0 && bytes[length - 1] === 0x0d) length -= 1;
  }
  return Uint8Array.from(bytes.subarray(0, length));
}

export class OwnerOnlyFileRuntimeCredentialSource implements RuntimeCredentialSource {
  private readonly pathsByCredentialId: ReadonlyMap<string, string>;

  constructor(bindings: readonly OwnerOnlyFileCredentialBinding[]) {
    if (bindings.length < 1 || bindings.length > MAX_BINDINGS) {
      throw new OwnerOnlyFileCredentialSourceError(
        "invalid_source_config",
        "The owner-only credential source configuration is invalid.",
      );
    }
    const pathsByCredentialId = new Map<string, string>();
    for (const binding of bindings) {
      if (
        !CREDENTIAL_ID_PATTERN.test(binding.credentialId) ||
        pathsByCredentialId.has(binding.credentialId)
      ) {
        throw new OwnerOnlyFileCredentialSourceError(
          "invalid_source_config",
          "The owner-only credential source configuration is invalid.",
        );
      }
      pathsByCredentialId.set(binding.credentialId, normalizedPath(binding.filePath));
    }
    this.pathsByCredentialId = pathsByCredentialId;
  }

  async load(credentialId: string): Promise<Uint8Array> {
    const path = this.pathsByCredentialId.get(credentialId);
    if (path === undefined) {
      throw new OwnerOnlyFileCredentialSourceError(
        "credential_material_unavailable",
        "The requested owner-only credential material is unavailable.",
      );
    }
    let bytes: Uint8Array | undefined;
    try {
      bytes = await readOwnerOnlyFile(path, MAX_FILE_BYTES);
      return materialWithoutFinalNewline(bytes);
    } catch (error) {
      throw new OwnerOnlyFileCredentialSourceError(
        "credential_material_unavailable",
        "The requested owner-only credential material is unavailable.",
        { cause: error },
      );
    } finally {
      bytes?.fill(0);
    }
  }
}
