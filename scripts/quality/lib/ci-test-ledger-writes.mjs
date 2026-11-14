/**
 * Repository writes of one shard (ADR-0565). Files of a shard run in parallel workers and in an
 * order the ledger cannot replay, so a path that any other process of the shard wrote may have
 * held other content when a file read it. A closure that touches such a path is not reproducible
 * from the reconstructed tree. Paths overlap when they are equal or one contains the other, so a
 * write below a listed directory or into a copied tree counts, and so does removing a directory
 * above an input. Writes by a file's own processes do not count: they follow from its own inputs.
 * A process that wrote through a path the recorder could not read could have written anything.
 * A child without a record of its own, started inside the repository, is treated the same way;
 * one started elsewhere is assumed to write there, which is a known gap. Only such unseen writers
 * are ordered: a file that finished before one started is untouched by it. Seen writes are not
 * ordered, because a path may be read again after its file's last record.
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

// Git subcommands that write only to the paths they are given, and their options that take a
// separate value, which is not a path to write.
const pathWritingGit = new Set(["clone", "init"]);
const valuedOptions = new Set([
  "-b",
  "--branch",
  "--initial-branch",
  "-o",
  "--origin",
  "-c",
  "--config",
  "--depth",
  "--template",
  "--reference",
  "--separate-git-dir",
  "-u",
  "--upload-pack",
  "--object-format",
]);

/** The subcommand of a recorded Git invocation and the operands after it, or `null`. */
function gitInvocation(args) {
  const [, ...rest] = args ?? [];
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "-C" || argument === "-c") index += 1;
    else if (!argument.startsWith("-")) {
      const operands = [];
      for (let next = index + 1; next < rest.length; next += 1)
        if (valuedOptions.has(rest[next])) next += 1;
        else if (!rest[next].startsWith("-")) operands.push(rest[next]);
      return { subcommand: argument, operands };
    }
  }
  return null;
}

/** A recorded path argument that the recorder classified outside the repository. */
const outsideRepository = (operand) =>
  operand.startsWith("<") && operand !== "<unknown>" && !operand.startsWith("<package:");

/** Whether a child without its own record may have written inside the repository. */
function blindRepositoryChild(child) {
  if (child.bootstrap || child.failed || String(child.cwd).startsWith("<")) return false;
  if (child.command === "git") {
    // The recorded tail holds at most eight arguments, so a longer command may hide its subcommand.
    const invocation = gitInvocation(child.args);
    if ((child.args?.length ?? 0) >= 8) return true;
    // Git with only global options, such as `--version`, runs no subcommand.
    if (invocation === null) return false;
    if (readOnlyGit.has(invocation.subcommand)) return false;
    return !(
      pathWritingGit.has(invocation.subcommand) &&
      invocation.operands.length > 0 &&
      invocation.operands.every(outsideRepository)
    );
  }
  return !child.inherited;
}

/**
 * Wall clocks of one machine order a shard's processes. A file whose processes all spooled their
 * final record more than this margin before an unseen writer started cannot have read its writes.
 */
const orderingMarginMs = 1000;

/** `records`: spool records with `file`, `writes`, `notes`, `startedAt` and `children`. */
export function createCiTestShardWrites(records) {
  const owners = new Map();
  const unseenWriters = [];
  for (const record of records) {
    const owner = record.file ?? null;
    for (const path of record.writes ?? []) {
      if (!owners.has(path)) owners.set(path, new Set());
      owners.get(path).add(owner);
    }
    // A record that dropped writes past its bound could have written anything, from its start, and
    // so could a child without a record of its own, such as a shell, working in the repository.
    if ((record.notes ?? []).includes("unobserved_write") || record.writesDropped)
      unseenWriters.push({ owner, from: record.startedAt ?? -Infinity });
    for (const child of record.children ?? [])
      if (blindRepositoryChild(child))
        unseenWriters.push({ owner, from: child.startedAt ?? -Infinity });
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
    /**
     * The first of `paths` that another process of the shard may have changed, or `null`.
     * `endedAt` is when the file's last process spooled its final record; unknown is `Infinity`.
     */
    writtenByOthers(file, paths, endedAt = Infinity) {
      if (
        unseenWriters.some(
          ({ owner, from }) => owner !== file && !(endedAt + orderingMarginMs < from),
        )
      )
        return "<unobserved write>";
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
