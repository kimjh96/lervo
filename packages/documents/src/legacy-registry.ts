import { validateSchema, type DocumentRegistry } from "@lervo/schemas";
import { parse } from "yaml";

export function parseLegacyDocumentRegistry(
  bytes: Uint8Array,
): DocumentRegistry | null {
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = parse(text);
  } catch {
    return null;
  }
  return validateSchema("documentRegistry", value).valid
    ? value as DocumentRegistry
    : null;
}
