import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const CHUNK = 128;
const MAXIMUM_OUTPUT_BYTES = 4 * 1024 * 1024;

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execute(
    "git",
    ["--no-optional-locks", "--literal-pathspecs", "-C", root, ...args],
    {
      encoding: "utf8",
      maxBuffer: MAXIMUM_OUTPUT_BYTES,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      timeout: 60_000,
      windowsHide: true,
    },
  );
  return stdout;
}

/** A repository-relative path git can take as a literal pathspec without leaving the tree. */
function askable(target: string): boolean {
  const segments = target.replace(/\/+$/u, "").split("/");
  return (
    target.length > 0 &&
    !target.startsWith("/") &&
    !target.includes("\0") &&
    !target.includes("\\") &&
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

/**
 * ADR-0558: the absent reference targets that no commit reachable from `head` ever contained.
 * Every file that ever existed was added by some commit, so one bounded `git log` per chunk lists
 * the additions under the asked paths, side branches included. Any doubt — git failure, shallow
 * history, output over the bound, or a path git cannot take literally — counts the target as
 * tracked, which keeps the removed-reference behaviour of ADR-0463.
 */
export async function neverTrackedReferenceTargets(input: {
  root: string;
  head: string;
  targets: Iterable<string>;
}): Promise<Set<string>> {
  const asked = [...new Set(input.targets)].filter(askable).sort();
  if (asked.length === 0) return new Set();
  const keys = new Set(asked.map((target) => target.replace(/\/+$/u, "")));
  const depth = Math.max(...[...keys].map((key) => key.split("/").length));
  const existed = new Set<string>();
  try {
    if ((await git(input.root, ["rev-parse", "--is-shallow-repository"])).trim() !== "false")
      return new Set();
    for (let index = 0; index < asked.length; index += CHUNK) {
      const output = await git(input.root, [
        // Root and merge commits can add files too; user settings must not hide them.
        "-c",
        "log.showRoot=true",
        "log",
        "--full-history",
        "--diff-merges=separate",
        "--no-renames",
        "--diff-filter=A",
        "--format=",
        "--name-only",
        "-z",
        input.head,
        "--",
        ...asked.slice(index, index + CHUNK),
      ]);
      for (const entry of output.split(/[\0\n]/u)) {
        const path = entry;
        if (path === "") continue;
        // A file under a directory target means the directory existed too. Only prefixes up to
        // the deepest asked target are compared, and only asked ones are kept.
        let end = -1;
        for (let level = 0; level < depth; level += 1) {
          end = path.indexOf("/", end + 1);
          const prefix = end === -1 ? path : path.slice(0, end);
          if (keys.has(prefix)) existed.add(prefix);
          if (end === -1) break;
        }
      }
    }
  } catch {
    return new Set();
  }
  return new Set(asked.filter((target) => !existed.has(target.replace(/\/+$/u, ""))));
}
