import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

function isRebuildableProjection(path) {
  return (
    (path.startsWith("docs/evidence/foundation/") && path.endsWith(".json")) ||
    path.startsWith("docs/knowledge/")
  );
}

export async function foundationSourceRevision(repositoryRoot) {
  const { stdout } = await execute(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
  );
  const files = stdout
    .toString("utf8")
    .split("\0")
    .filter((path) => path && !isRebuildableProjection(path))
    .sort();
  const hash = createHash("sha256");
  for (const path of files) {
    let content;
    try {
      content = await readFile(resolve(repositoryRoot, path));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    hash.update(path);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
