import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const evidencePath = "docs/evidence/foundation/execution-performance-v1.json";

function isRebuildableProjection(path) {
  return path === evidencePath || path.startsWith("docs/knowledge/");
}

export async function foundationPerformanceSourceRevision(repositoryRoot) {
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
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(resolve(repositoryRoot, path)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
