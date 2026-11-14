/**
 * Repository writes of one shard (ADR-0565). Files of a shard run in parallel workers and in an
 * order the ledger cannot replay, so a path that any other process of the shard wrote may have
 * held other content when a file read it. A closure that touches such a path is not reproducible
 * from the reconstructed tree. Paths overlap when they are equal or one contains the other, so a
 * write below a listed directory or into a copied tree counts, and so does removing a directory
 * above an input. Writes by a file's own processes do not count: they follow from its own inputs.
 * A process that wrote through a path the recorder could not read could have written anything.
 * A child without a record of its own, started inside the repository, is treated the same way;
 * one started elsewhere is assumed to write there, which is a known gap.
 */
// Git subcommands that change nothing outside `.git`. A file that reads `.git` is already
// `git_in_repository`, so these cannot change another file's closure. `status` and `diff` may
// refresh the index, which is inside `.git`.
const readOnlyGit = new Set([
  "cat-file",
  "describe",
  "diff",
  "for-each-ref",
  "log",
  "ls-files",
  "ls-tree",
  "merge-base",
  "rev-list",
  "rev-parse",
  "show",
  "show-ref",
  "status",
  "symbolic-ref",
]);

/** The subcommand of a recorded Git invocation, or `null` when the tail does not show it. */
function gitSubcommand(args) {
  const [, ...rest] = args ?? [];
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "-C" || argument === "-c") index += 1;
    else if (!argument.startsWith("-")) return argument;
  }
  return null;
}

/** Whether a child without its own record may have written inside the repository. */
function blindRepositoryChild(child) {
  if (child.bootstrap || child.failed || String(child.cwd).startsWith("<")) return false;
  if (child.command === "git")
    // The recorded tail holds at most eight arguments, so a longer command may hide its subcommand.
    return (child.args?.length ?? 0) >= 8 || !readOnlyGit.has(gitSubcommand(child.args));
  return !child.inherited;
}

/** `records`: spool records with `file`, `writes` and `notes`. */
export function createCiTestShardWrites(records) {
  const owners = new Map();
  const unknownWriters = new Set();
  for (const record of records) {
    const owner = record.file ?? null;
    for (const path of record.writes ?? []) {
      if (!owners.has(path)) owners.set(path, new Set());
      owners.get(path).add(owner);
    }
    // A record that dropped writes past its bound could have written anything too, and so could
    // a child without a record of its own, such as Git or a shell, working inside the repository.
    const blindChild = (record.children ?? []).some(blindRepositoryChild);
    if ((record.notes ?? []).includes("unobserved_write") || record.writesDropped || blindChild)
      unknownWriters.add(owner);
  }
  const written = [...owners.keys()].sort();
  const byOther = (path, file) => [...owners.get(path)].some((owner) => owner !== file);

  /** Paths below `path` that another owner wrote, found by binary search in the sorted list. */
  function descendantByOther(path, file) {
    if (path === ".") return written.find((candidate) => byOther(candidate, file)) ?? null;
    const prefix = `${path}/`;
    let low = 0;
    let high = written.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (written[middle] < prefix) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < written.length && written[index].startsWith(prefix); index += 1)
      if (byOther(written[index], file)) return written[index];
    return null;
  }

  return {
    size: written.length,
    /** The first of `paths` that another process of the shard may have changed, or `null`. */
    writtenByOthers(file, paths) {
      if ([...unknownWriters].some((owner) => owner !== file)) return "<unobserved write>";
      for (const path of paths) {
        if (owners.has(path) && byOther(path, file)) return path;
        if (owners.has(".") && byOther(".", file)) return path;
        const parts = path.split("/");
        for (let length = parts.length - 1; length > 0; length -= 1) {
          const ancestor = parts.slice(0, length).join("/");
          if (owners.has(ancestor) && byOther(ancestor, file)) return path;
        }
        if (descendantByOther(path, file) !== null) return path;
      }
      return null;
    },
  };
}
