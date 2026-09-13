import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { roleSha256 } from "./integrity.js";
import {
  assertResearchSourcePolicy,
  researchSourcePolicyPath,
  type ResearchSourcePolicyV1,
} from "./research-contract.js";

/** Reads bounded regular repository files, without following a source or ancestor symlink. */
export async function readResearchSourceFile(
  repositoryRoot: string,
  path: string,
  maximumBytes: number,
) {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > 131072 ||
    path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    /[\\\0\r\n]/u.test(path)
  )
    throw new Error("The research source path is invalid.");
  let absolute = await realpath(repositoryRoot);
  const ancestry: { path: string; dev: number; ino: number }[] = [];
  const parts = path.split("/");
  for (let index = 0; index < parts.length; index++) {
    absolute = resolve(absolute, parts[index]!);
    const info = await lstat(absolute);
    if (
      info.isSymbolicLink() ||
      (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())
    )
      throw new Error("Research sources require existing regular files and directory ancestors.");
    ancestry.push({ path: absolute, dev: info.dev, ino: info.ino });
  }
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    const expected = ancestry.at(-1)!;
    if (
      !before.isFile() ||
      before.dev !== expected.dev ||
      before.ino !== expected.ino ||
      before.size > maximumBytes
    )
      throw new Error("The research source exceeds its byte bound.");
    const buffer = Buffer.alloc(maximumBytes + 1);
    let count = 0;
    while (count < buffer.byteLength) {
      const read = await handle.read(buffer, count, buffer.byteLength - count, count);
      if (read.bytesRead === 0) break;
      count += read.bytesRead;
    }
    const bytes = buffer.subarray(0, count);
    const after = await handle.stat();
    if (
      bytes.byteLength > maximumBytes ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      (await lstat(absolute)).ino !== after.ino
    )
      throw new Error("The research source changed while being read.");
    for (const [index, entry] of ancestry.entries()) {
      const current = await lstat(entry.path);
      if (
        current.dev !== entry.dev ||
        current.ino !== entry.ino ||
        current.isSymbolicLink() ||
        (index === ancestry.length - 1 ? !current.isFile() : !current.isDirectory())
      )
        throw new Error("The research source ancestry changed while being read.");
    }
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      contentHash: roleSha256(bytes),
    };
  } finally {
    await handle.close();
  }
}

export async function loadResearchSourcePolicy(repositoryRoot: string, projectId: string) {
  const original = await readResearchSourceFile(repositoryRoot, researchSourcePolicyPath, 16384);
  const policy = JSON.parse(original.text) as ResearchSourcePolicyV1;
  assertResearchSourcePolicy(policy);
  if (policy.projectId !== projectId)
    throw new Error("The source policy belongs to another repository project.");
  return { policy, ...original };
}
