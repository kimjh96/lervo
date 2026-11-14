"use strict";

const { observeCalls, ownData, pathText } = require("./ci-test-input-transparent-call.cjs");

/**
 * Translates Node filesystem calls into observations (ADR-0565). A call only names a path; the
 * recorder resolves whether it exists, and lists a directory, when it spools the record. The
 * wrapper therefore never inspects results, errors, callbacks or promises, so their identity,
 * timing and unhandled-rejection behavior are the original's. Node's module loaders call the
 * public `readFileSync` (CommonJS, and ESM from Node 22.15) or `fs.promises.readFile` (ESM on
 * Node 22.13), so module loads are observed here too.
 */

// `read` reads bytes, `open` reads bytes unless its flags only write, `probe` reads metadata,
// `list` reads a directory listing, and `tree` copies a whole subtree.
const operations = {
  readFile: "read",
  open: "open",
  stat: "probe",
  lstat: "probe",
  exists: "probe",
  access: "probe",
  realpath: "probe",
  readlink: "probe",
  readdir: "list",
  opendir: "list",
  copyFile: "read",
  cp: "tree",
  createReadStream: "read",
};

/** Flags that only write, such as `w` or `O_WRONLY`, are not inputs; other values may read. */
function opensForReading(flags, writeOnly) {
  if (typeof flags === "number") return (flags & writeOnly) === 0;
  if (typeof flags === "string") return flags.startsWith("r");
  return true;
}

function installFilesystemObserver({ fs, observe }) {
  const writeOnly = fs.constants.O_WRONLY;
  const hooksFor = (operation) => ({
    before(args) {
      const path = pathText(args[0]);
      if (path === null) return;
      if (operation === "open") {
        if (opensForReading(args[1], writeOnly)) observe("read", path);
      } else if (operation === "list")
        observe("list", path, ownData(args[1], "recursive") === true);
      else observe(operation, path);
    },
  });
  const wrap = (owner, name, operation) => {
    if (typeof owner[name] !== "function") return;
    owner[name] = observeCalls(owner[name], hooksFor(operation));
  };
  for (const [name, operation] of Object.entries(operations)) {
    wrap(fs, name, operation);
    wrap(fs, `${name}Sync`, operation);
    if (name !== "exists" && name !== "createReadStream") wrap(fs.promises, name, operation);
  }
  for (const name of ["realpath", "realpathSync"])
    if (typeof fs[name]?.native === "function")
      // The Proxy forwards property writes to the original, so `native` is replaced there.
      fs[name].native = observeCalls(fs[name].native, hooksFor("probe"));
}

module.exports = { installFilesystemObserver };
