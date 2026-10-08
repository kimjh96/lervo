import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { repositorySourceClassificationForPath } from "@lervo/repository-knowledge";

const execute = promisify(execFile);
const MAXIMUM_OBJECT_BYTES = 4 * 1024 * 1024;

export function freshnessEvidencePathAllowed(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 1_024 &&
    !path.startsWith("/") &&
    !path.split("/").some((part) => part === ".." || part === ".git" || part === ".lervo") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    repositorySourceClassificationForPath(path) === "ordinary"
  );
}

export async function freshnessGit(root: string, args: string[]): Promise<string> {
  const { stdout } = await execute(
    "git",
    ["--no-optional-locks", "--literal-pathspecs", "-C", root, ...args],
    {
      encoding: "utf8",
      maxBuffer: MAXIMUM_OBJECT_BYTES,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      timeout: 60_000,
      windowsHide: true,
    },
  );
  return stdout;
}

export async function freshnessBlob(
  root: string,
  revision: string,
  path: string,
): Promise<Buffer | null> {
  if (!freshnessEvidencePathAllowed(path)) return null;
  try {
    const spec = `${revision}:${path}`;
    // Refuse symlinks and gitlinks even though a symlink is stored as a blob.
    const mode = await freshnessGit(root, ["ls-tree", "-z", revision, "--", path]);
    if (!mode.startsWith("100644 blob ") && !mode.startsWith("100755 blob ")) return null;
    const { stdout } = await execute("git", ["-C", root, "cat-file", "blob", spec], {
      encoding: "buffer",
      maxBuffer: MAXIMUM_OBJECT_BYTES,
      timeout: 60_000,
      windowsHide: true,
    });
    if (stdout.includes(0)) return null;
    new TextDecoder("utf8", { fatal: true }).decode(stdout);
    return stdout;
  } catch {
    return null;
  }
}

export async function freshnessObject(
  root: string,
  revision: string,
  path: string,
): Promise<{ kind: "blob" | "tree"; id: string } | null> {
  if (!freshnessEvidencePathAllowed(path)) return null;
  const raw = await freshnessGit(root, ["ls-tree", "-z", revision, "--", path]);
  const match = /^(?:100644|100755|040000) (blob|tree) ([a-f0-9]{40,64})\t/u.exec(raw);
  if (raw !== "" && match === null)
    throw Object.assign(
      new Error("Freshness evidence object is not a regular file or directory."),
      { code: "freshness_evidence_unavailable" },
    );
  return match === null ? null : { kind: match[1] as "blob" | "tree", id: match[2]! };
}

export function freshnessExcerpt(text: string, needles: readonly string[]): string[] {
  const lines = text.split(/\r?\n/u);
  const selected = new Set<number>();
  for (const [index, line] of lines.entries()) {
    if (!needles.some((needle) => line.includes(needle))) continue;
    for (
      let near = Math.max(0, index - 3);
      near <= Math.min(lines.length - 1, index + 3);
      near += 1
    )
      if (selected.size < 40) selected.add(near);
    if (selected.size === 40) break;
  }
  if (selected.size === 0)
    for (let index = 0; index < Math.min(40, lines.length); index += 1) selected.add(index);
  return [...selected].sort((a, b) => a - b).map((index) => `${index + 1}: ${lines[index]}`);
}
