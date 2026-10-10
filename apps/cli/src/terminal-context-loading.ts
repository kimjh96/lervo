import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { sha256, type KnowledgeQueryHit } from "@lervo/repository-knowledge";

export type TerminalDocumentLoadFailure =
  | "capacity_exhausted"
  | "source_unsafe"
  | "source_oversized"
  | "source_changed"
  | "source_invalid_utf8"
  | "source_unavailable";

export type TerminalDocumentLoad =
  | { disposition: "loaded"; content: string; scope: "full" | "prefix" }
  | { disposition: "unavailable"; reason: TerminalDocumentLoadFailure };

const TRUNCATION_NOTICE = "\n[Lervo content truncated]";

function truncateUtf8(value: string, maximumBytes: number): string {
  if (maximumBytes <= 0) return "";
  if (Buffer.byteLength(value) <= maximumBytes) return value;
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maximumBytes) break;
    bytes += characterBytes;
    end += character.length;
  }
  return value.slice(0, end);
}

export async function loadSelectedTerminalDocument(input: {
  repositoryRoot: string;
  hit: KnowledgeQueryHit;
  maximumBytes: number;
}): Promise<TerminalDocumentLoad> {
  const target = resolve(input.repositoryRoot, input.hit.path);
  const child = relative(input.repositoryRoot, target);
  if (child === ".." || child.startsWith(`..${sep}`))
    return { disposition: "unavailable", reason: "source_unsafe" };
  if (input.maximumBytes <= 0) return { disposition: "unavailable", reason: "capacity_exhausted" };
  let handle;
  try {
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink())
      return { disposition: "unavailable", reason: "source_unsafe" };
    if (before.size > 131_072) return { disposition: "unavailable", reason: "source_oversized" };
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size ||
      sha256(bytes) !== input.hit.contentHash
    )
      return { disposition: "unavailable", reason: "source_changed" };
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { disposition: "unavailable", reason: "source_invalid_utf8" };
    }
    if (Buffer.byteLength(content) <= input.maximumBytes)
      return { disposition: "loaded", content, scope: "full" };
    const noticeBytes = Buffer.byteLength(TRUNCATION_NOTICE);
    if (input.maximumBytes <= noticeBytes)
      return { disposition: "unavailable", reason: "capacity_exhausted" };
    return {
      disposition: "loaded",
      content: `${truncateUtf8(content, input.maximumBytes - noticeBytes)}${TRUNCATION_NOTICE}`,
      scope: "prefix",
    };
  } catch (error) {
    return {
      disposition: "unavailable",
      reason:
        (error as NodeJS.ErrnoException).code === "ELOOP" ? "source_unsafe" : "source_unavailable",
    };
  } finally {
    await handle?.close();
  }
}
