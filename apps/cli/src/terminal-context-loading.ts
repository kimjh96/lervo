import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { sha256, type KnowledgeQueryHit } from "@lervo/repository-knowledge";

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
}): Promise<{ content: string; scope: "full" | "prefix" } | null> {
  const target = resolve(input.repositoryRoot, input.hit.path);
  const child = relative(input.repositoryRoot, target);
  if (child === ".." || child.startsWith(`..${sep}`) || input.maximumBytes <= 0) return null;
  let handle;
  try {
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.size > 131_072) return null;
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
      return null;
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (Buffer.byteLength(content) <= input.maximumBytes) return { content, scope: "full" };
    const noticeBytes = Buffer.byteLength(TRUNCATION_NOTICE);
    if (input.maximumBytes <= noticeBytes) return null;
    return {
      content: `${truncateUtf8(content, input.maximumBytes - noticeBytes)}${TRUNCATION_NOTICE}`,
      scope: "prefix",
    };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}
