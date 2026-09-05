import { createHash } from "node:crypto";

export interface SkillContentFile {
  path: string;
  bytes: Uint8Array;
}

const MAXIMUM_FILES = 256;
const MAXIMUM_BYTES = 16 * 1024 * 1024;

export function hashSkillContentFiles(files: readonly SkillContentFile[]): string {
  if (files.length === 0 || files.length > MAXIMUM_FILES)
    throw new TypeError("A skill package must contain a bounded set of content files.");
  const paths = new Set<string>();
  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const file of [...files].sort((left, right) =>
    left.path === right.path ? 0 : left.path < right.path ? -1 : 1,
  )) {
    if (
      file.path.length === 0 ||
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      file.path.split("/").some((part) => part.length === 0 || part === "." || part === "..") ||
      paths.has(file.path)
    )
      throw new TypeError("A skill package contains an unsafe or duplicate content path.");
    paths.add(file.path);
    totalBytes += file.bytes.byteLength;
    if (totalBytes > MAXIMUM_BYTES)
      throw new TypeError("A skill package exceeds the content byte limit.");
    hash.update(`${Buffer.byteLength(file.path)}:${file.path}:${file.bytes.byteLength}:`);
    hash.update(file.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}
