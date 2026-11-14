"use strict";

const { entries, SafeSet } = require("./ci-test-input-intrinsics.cjs");
const { observeCalls, ownDataState, pathText } = require("./ci-test-input-transparent-call.cjs");

/**
 * Translates Node filesystem calls into observations (ADR-0565). A call only names a path; the
 * recorder resolves whether it exists, and lists a directory, when it spools the record. The
 * wrapper therefore never inspects results, errors, callbacks or promises, so their identity,
 * timing and unhandled-rejection behavior are the original's. Node's module loaders call the
 * public `readFileSync` (CommonJS, and ESM from Node 22.15) or `fs.promises.readFile` (ESM on
 * Node 22.13), so module loads are observed here too.
 *
 * Every argument position that names a path is observed. A file descriptor needs no observation:
 * the `open` call that returned it named the path and its flags. A path the recorder cannot read
 * as text (a `FileHandle`, a non-URL object, a Buffer that is not UTF-8) is reported as
 * `unobserved`, and so is a call to an API whose inputs cannot be named (`glob`, `watch`). The
 * ledger then never treats the process's closure as complete.
 */

// `read` reads bytes, `probe` reads metadata, `list` reads a directory listing, `tree` copies a
// whole subtree, and `write` changes a path. Each entry names the argument index of each path.
const operations = {
  readFile: [["read", 0]],
  open: [["open", 0]],
  openAsBlob: [["read", 0]],
  stat: [["probe", 0]],
  lstat: [["probe", 0]],
  statfs: [["probe", 0]],
  exists: [["probe", 0]],
  access: [["probe", 0]],
  realpath: [["probe", 0]],
  readlink: [["probe", 0]],
  readdir: [["list", 0]],
  opendir: [["list", 0]],
  copyFile: [
    ["read", 0],
    ["write", 1],
  ],
  cp: [
    ["tree", 0],
    ["write", 1],
  ],
  createReadStream: [["read", 0]],
  createWriteStream: [["write", 0]],
  writeFile: [["write", 0]],
  appendFile: [["write", 0]],
  truncate: [["write", 0]],
  mkdir: [["write", 0]],
  mkdtemp: [["write-prefix", 0]],
  rm: [["write", 0]],
  rmdir: [["write", 0]],
  unlink: [["write", 0]],
  // A rename moves the source's bytes to the destination, so the source is also read.
  rename: [
    ["read", 0],
    ["write", 0],
    ["write", 1],
  ],
  // A link makes its target readable under another name, so the target is read.
  symlink: [
    ["link-target", 0],
    ["write", 1],
  ],
  link: [
    ["read", 0],
    ["write", 1],
  ],
  chmod: [["write", 0]],
  lchmod: [["write", 0]],
  chown: [["write", 0]],
  lchown: [["write", 0]],
  utimes: [["write", 0]],
  lutimes: [["write", 0]],
};
/** Calls whose inputs cannot be named from their arguments. */
const unnamed = ["glob", "watch", "watchFile"];
const noPromise = new SafeSet(["exists", "createReadStream", "createWriteStream", "openAsBlob"]);

/** `{ read, write }` for open flags; an unknown value counts as both. */
function openAccess(flags, { writeOnly, writing }) {
  // `open(path, callback)` passes the callback where the flags would be: the default is `r`.
  if (flags === undefined || flags === null || typeof flags === "function")
    return { read: true, write: false };
  if (typeof flags === "number")
    return { read: (flags & writeOnly) === 0, write: (flags & writing) !== 0 };
  if (typeof flags === "string") {
    const plainRead = flags === "r" || flags === "rs" || flags === "sr";
    return { read: flags.startsWith("r") || flags.includes("+"), write: !plainRead };
  }
  return { read: true, write: true };
}

function installFilesystemObserver({ fs, observe }) {
  const { O_WRONLY, O_RDWR, O_CREAT, O_TRUNC, O_APPEND } = fs.constants;
  const flagBits = {
    writeOnly: O_WRONLY,
    writing: O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_APPEND,
  };
  const hooksFor = (positions) => ({
    before(args) {
      for (const [operation, index] of positions) {
        const value = args[index];
        // A descriptor names the file its `open` call named, and that call was observed.
        if (typeof value === "number") continue;
        const path = pathText(value);
        if (path === null) {
          // A missing optional argument names nothing; anything else is a path not observed.
          if (value === undefined && index !== 0) continue;
          // An unreadable path that `open` only reads is an unobserved read, not a write.
          const kind =
            operation === "open" && !openAccess(args[1], flagBits).write ? "read" : operation;
          observe("unobserved", null, kind);
          continue;
        }
        if (operation === "open") {
          const access = openAccess(args[1], flagBits);
          if (access.read) observe("read", path);
          if (access.write) observe("write", path);
        } else if (operation === "list") {
          // An option the hook cannot read may be either kind, so both listings are recorded.
          const recursive = ownDataState(args[1], "recursive");
          observe("list", path, recursive.known ? recursive.value === true : "unknown");
        } else if (operation === "link-target") observe("link-target", path, pathText(args[1]));
        else observe(operation, path);
      }
    },
  });
  const wrap = (owner, name, positions) => {
    if (typeof owner?.[name] !== "function") return;
    owner[name] = observeCalls(owner[name], hooksFor(positions));
  };
  for (const [name, positions] of entries(operations)) {
    wrap(fs, name, positions);
    wrap(fs, `${name}Sync`, positions);
    if (!noPromise.has(name)) wrap(fs.promises, name, positions);
  }
  for (const name of unnamed) {
    const hooks = { before: () => observe("unobserved", null, name) };
    for (const owner of [fs, fs.promises])
      for (const variant of [name, `${name}Sync`])
        if (typeof owner?.[variant] === "function")
          owner[variant] = observeCalls(owner[variant], hooks);
  }
  for (const name of ["realpath", "realpathSync"])
    if (typeof fs[name]?.native === "function")
      // The Proxy forwards property writes to the original, so `native` is replaced there.
      fs[name].native = observeCalls(fs[name].native, hooksFor([["probe", 0]]));
}

module.exports = { installFilesystemObserver };
