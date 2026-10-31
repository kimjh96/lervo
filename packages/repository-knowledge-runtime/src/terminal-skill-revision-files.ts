import { execFile } from "node:child_process";
import { posix } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const MAXIMUM_BYTES = 256 * 1024;
interface TreeEntry {
  mode: string;
  hash: string;
}

/** Bounded Git object reads. No working-tree file can supply historical skill evidence. */
export async function terminalSkillRevisionFiles(root: string, revision?: string) {
  const commit =
    revision ??
    (
      await execute("git", ["-C", root, "rev-parse", "--verify", "HEAD^{commit}"], {
        timeout: 2000,
        maxBuffer: 1024,
      })
    ).stdout.trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commit)) throw new Error("Invalid skill revision.");
  const { stdout } = await execute(
    "git",
    ["-C", root, "ls-tree", "-r", "-z", commit, "--", ".agents", ".claude/skills", ".codex/skills"],
    { timeout: 5000, maxBuffer: 2 * 1024 * 1024 },
  );
  const tree = new Map<string, TreeEntry>();
  const entries = stdout.split("\0").filter(Boolean);
  if (entries.length > 8192) throw new Error("Skill tree exceeds its bound.");
  for (const line of entries) {
    const match = /^(\d+) blob ([a-f0-9]+)\t(.+)$/u.exec(line);
    if (match) tree.set(match[3]!, { mode: match[1]!, hash: match[2]! });
  }
  const cache = new Map<string, Buffer>();
  async function bytes(entry: TreeEntry): Promise<Buffer> {
    const cached = cache.get(entry.hash);
    if (cached) return cached;
    const { stdout } = await execute("git", ["-C", root, "cat-file", "blob", entry.hash], {
      encoding: "buffer",
      timeout: 2000,
      maxBuffer: MAXIMUM_BYTES + 1,
    });
    if (stdout.length > MAXIMUM_BYTES) throw new Error("Skill blob exceeds its bound.");
    cache.set(entry.hash, stdout);
    return stdout;
  }
  async function follow(path: string): Promise<string | null> {
    for (let depth = 0; depth < 16; depth++) {
      if (posix.isAbsolute(path) || path === ".." || path.startsWith("../")) return null;
      const parts = path.split("/");
      let changed = false;
      for (let index = 1; index <= parts.length; index++) {
        const prefix = parts.slice(0, index).join("/");
        const entry = tree.get(prefix);
        if (entry?.mode !== "120000") continue;
        const target = (await bytes(entry)).toString("utf8");
        if (posix.isAbsolute(target) || target.includes("\0")) return null;
        path = posix.normalize(posix.join(posix.dirname(prefix), target, ...parts.slice(index)));
        changed = true;
        break;
      }
      if (!changed) return path;
    }
    throw new Error("Skill link exceeds its traversal bound.");
  }
  function names(directory: string): string[] {
    const names = [
      ...new Set(
        [...tree.keys()]
          .filter((path) => path.startsWith(`${directory}/`))
          .map((path) => path.slice(directory.length + 1).split("/")[0]!),
      ),
    ].sort();
    if (names.length > 1024) throw new Error("Installed skill catalog exceeds its bound.");
    return names;
  }
  return {
    names,
    follow,
    async read(path: string) {
      const entry = tree.get(path);
      return entry && /^100(?:644|755)$/u.test(entry.mode) ? bytes(entry) : null;
    },
  };
}
