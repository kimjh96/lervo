"use strict";

/**
 * Translates Node filesystem calls into observations (ADR-0565). Each wrapper calls the original
 * first and returns or throws exactly what it did; observation failures are swallowed so the
 * recorder can never change a test result. Node's own module loaders call the public `readFileSync`
 * (CommonJS, and ESM from Node 22.15) or `fs.promises.readFile` (ESM on Node 22.13), so module
 * loads are observed here too.
 */

// Each operation: `read` reads bytes, `open` reads bytes unless its flags only write, `probe` reads
// metadata, `list` reads a directory listing, and `tree` copies a whole subtree whose members the
// copy itself does not report.
const syncOperations = {
  readFileSync: "read",
  openSync: "open",
  statSync: "probe",
  lstatSync: "probe",
  existsSync: "probe",
  accessSync: "probe",
  realpathSync: "probe",
  readlinkSync: "probe",
  readdirSync: "list",
  opendirSync: "list",
  copyFileSync: "read",
  cpSync: "tree",
};
const callbackOperations = {
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
};
const promiseOperations = {
  readFile: "read",
  open: "open",
  stat: "probe",
  lstat: "probe",
  access: "probe",
  realpath: "probe",
  readlink: "probe",
  readdir: "list",
  opendir: "list",
  copyFile: "read",
  cp: "tree",
};
const missing = new Set(["ENOENT", "ENOTDIR"]);

function copyProperties(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    if (["length", "name", "prototype"].includes(key) || Object.hasOwn(target, key)) continue;
    Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
  }
  return target;
}

/** Open flags that only write, such as `w` or `O_WRONLY`, are not inputs. */
function opensForReading(flags, writeOnly) {
  if (flags === undefined || flags === null) return true;
  if (typeof flags === "number") return (flags & writeOnly) === 0;
  return String(flags).startsWith("r");
}

function listingOptions(options) {
  return typeof options === "object" && options !== null
    ? { recursive: options.recursive === true, withFileTypes: options.withFileTypes === true }
    : { recursive: false, withFileTypes: false };
}

function installFilesystemObserver({ fs, observe }) {
  const writeOnly = fs.constants.O_WRONLY;
  // `observe(operation, pathArgument, outcome, detail)`; outcome is `ok`, `absent` or `error`.
  const report = (operation, args, outcome, value) => {
    try {
      if (operation === "open") {
        if (!opensForReading(args[1], writeOnly)) return;
        observe("read", args[0], outcome);
      } else if (operation === "list")
        observe("list", args[0], outcome, { listing: value, options: listingOptions(args[1]) });
      else observe(operation, args[0], outcome);
    } catch {
      // Observation never changes the observed call.
    }
  };
  const outcomeOf = (error) => (missing.has(error?.code) ? "absent" : "error");

  const wrapSync = (original, operation, name) =>
    copyProperties(
      {
        [name](...args) {
          let result;
          try {
            result = original.apply(this, args);
          } catch (error) {
            report(operation, args, outcomeOf(error));
            throw error;
          }
          // `existsSync` reports absence by value, and `statSync` too with `throwIfNoEntry: false`.
          const absent =
            (name === "existsSync" && result === false) ||
            (["statSync", "lstatSync"].includes(name) && result === undefined);
          report(operation, args, absent ? "absent" : "ok", result);
          return result;
        },
      }[name],
      original,
    );

  const wrapCallback = (original, operation, name) =>
    copyProperties(
      {
        [name](...args) {
          const last = args.length - 1;
          if (typeof args[last] !== "function") return original.apply(this, args);
          const callback = args[last];
          const observed = args.slice(0, last);
          args[last] =
            name === "exists"
              ? function (present) {
                  report(operation, observed, present ? "ok" : "absent");
                  return callback.apply(this, arguments);
                }
              : function (error, result) {
                  report(operation, observed, error ? outcomeOf(error) : "ok", result);
                  return callback.apply(this, arguments);
                };
          return original.apply(this, args);
        },
      }[name],
      original,
    );

  const wrapPromise = (original, operation, name) =>
    copyProperties(
      {
        [name](...args) {
          return original.apply(this, args).then(
            (result) => {
              report(operation, args, "ok", result);
              return result;
            },
            (error) => {
              report(operation, args, outcomeOf(error));
              throw error;
            },
          );
        },
      }[name],
      original,
    );

  for (const [name, operation] of Object.entries(syncOperations)) {
    if (typeof fs[name] !== "function") continue;
    const wrapped = wrapSync(fs[name], operation, name);
    if (typeof fs[name].native === "function")
      wrapped.native = wrapSync(fs[name].native, operation, name);
    fs[name] = wrapped;
  }
  for (const [name, operation] of Object.entries(callbackOperations)) {
    if (typeof fs[name] !== "function") continue;
    const wrapped = wrapCallback(fs[name], operation, name);
    if (typeof fs[name].native === "function")
      wrapped.native = wrapCallback(fs[name].native, operation, name);
    fs[name] = wrapped;
  }
  for (const [name, operation] of Object.entries(promiseOperations))
    if (typeof fs.promises[name] === "function")
      fs.promises[name] = wrapPromise(fs.promises[name], operation, name);
  const originalCreateReadStream = fs.createReadStream;
  fs.createReadStream = copyProperties(function createReadStream(...args) {
    report("read", [args[0]], "ok");
    return originalCreateReadStream.apply(this, args);
  }, originalCreateReadStream);
}

module.exports = { installFilesystemObserver };
