"use strict";

const {
  arrayFrom,
  getOwnPropertyDescriptor,
  hasOwn,
  isArray,
  isProxy,
  processObject,
} = require("./ci-test-input-intrinsics.cjs");
const {
  observeCalls,
  ownData,
  ownDataState,
  pathText,
} = require("./ci-test-input-transparent-call.cjs");

/**
 * Translates child process creation into observations (ADR-0565). Asynchronous APIs all reach
 * `ChildProcess.prototype.spawn`; each synchronous API is wrapped at its public name. Options,
 * arguments and environment pairs are read without running user code, because callers can pass
 * their own objects to every one of them. A value that would need a getter, a Proxy trap or a
 * string conversion is reported as unknown. Observations carry only the variables that decide
 * whether the child inherits the recorder, never the environment.
 */
const inheritedVariables = [
  "NODE_OPTIONS",
  "LERVO_CI_TEST_LEDGER",
  "LERVO_CI_TEST_LEDGER_DIRECTORY",
];

/** Reads the variables as Node would: own enumerable keys only, primitive values only. */
function fromObject(env) {
  if (env === null || typeof env !== "object" || isProxy(env)) return null;
  const values = {};
  for (const name of inheritedVariables) {
    const descriptor = getOwnPropertyDescriptor(env, name);
    if (descriptor === undefined || !descriptor.enumerable) continue;
    if (!hasOwn(descriptor, "value")) return null;
    const { value } = descriptor;
    if (value !== null && ["object", "function", "symbol"].includes(typeof value)) return null;
    values[name] = `${value}`;
  }
  return values;
}

/** The current `process.env`, read as a data property of the process object. */
const processEnvironment = () => fromObject(ownData(processObject, "env"));

/** Elements of a non-Proxy array through own data properties; others are `undefined`. */
function elements(values) {
  if (!isArray(values) || isProxy(values)) return null;
  const length = ownData(values, "length");
  return typeof length === "number"
    ? arrayFrom({ length }, (_, index) => ownData(values, index))
    : null;
}

function fromPairs(pairs) {
  const list = elements(pairs);
  // A pair the hook cannot read may set NODE_OPTIONS, so the environment is unknown.
  if (list === null || list.some((pair) => typeof pair !== "string")) return null;
  const values = {};
  for (const pair of list) {
    const separator = pair.indexOf("=");
    const name = separator > 0 ? pair.slice(0, separator) : null;
    if (inheritedVariables.includes(name)) values[name] = pair.slice(separator + 1);
  }
  return values;
}

/** String elements of a non-Proxy array; any other element is shown, never converted. */
function argumentList(values) {
  return (elements(values) ?? []).map((value) => (typeof value === "string" ? value : "<unread>"));
}

/** Mirrors Node's optional `args` and `options` positions for the synchronous APIs. */
function describeFile(file, maybeArgs, maybeOptions) {
  const args = isArray(maybeArgs) ? maybeArgs : undefined;
  const options = args === undefined ? (maybeArgs ?? maybeOptions) : maybeOptions;
  const env = ownDataState(options, "env");
  const cwd = ownDataState(options, "cwd");
  return {
    file: typeof file === "string" ? file : "<unread>",
    args: argumentList(args),
    // `undefined` runs in this process's directory; `null` is a directory the hook cannot read.
    cwd: !cwd.known ? null : cwd.value == null ? undefined : pathText(cwd.value),
    environment: !env.known ? null : env.value ? fromObject(env.value) : processEnvironment(),
    synchronous: true,
  };
}

/** Node puts launch failures in `error`, with `status` null; a child that ran has a status. */
function launchFailed(error) {
  const code = ownData(error, "code");
  return (
    typeof code === "string" && ownData(error, "status") == null && ownData(error, "signal") == null
  );
}

function installChildProcessObserver({ childProcess, observe }) {
  const { prototype } = childProcess.ChildProcess;
  prototype.spawn = observeCalls(prototype.spawn, {
    // `options` here is the object Node built in `normalizeSpawnArguments`.
    before: ([options]) => options,
    after(options, _, child) {
      const pid = ownData(child, "pid");
      observe({
        file: ownData(options, "file") ?? "<unread>",
        args: argumentList(ownData(options, "args")).slice(1),
        cwd: ownData(options, "cwd") == null ? undefined : pathText(ownData(options, "cwd")),
        environment: fromPairs(ownData(options, "envPairs")),
        pid,
        synchronous: false,
        failed: pid === undefined,
      });
    },
  });
  childProcess.spawnSync = observeCalls(childProcess.spawnSync, {
    before: (args) => describeFile(...args),
    after(entry, result) {
      const pid = ownData(result, "pid");
      observe({ ...entry, pid: pid || undefined, failed: !pid });
    },
  });
  childProcess.execFileSync = observeCalls(childProcess.execFileSync, {
    before: (args) => describeFile(...args),
    after: (entry) => observe({ ...entry, failed: false }),
    thrown: (entry, error) => observe({ ...entry, failed: launchFailed(error) }),
  });
  childProcess.execSync = observeCalls(childProcess.execSync, {
    before([command, options]) {
      const shell = ownData(options, "shell");
      return {
        ...describeFile(typeof shell === "string" ? shell : "/bin/sh", [], options),
        args: ["-c", typeof command === "string" ? command : "<unread>"],
      };
    },
    after: (entry) => observe({ ...entry, failed: false }),
    thrown: (entry, error) => observe({ ...entry, failed: launchFailed(error) }),
  });
}

module.exports = { installChildProcessObserver };
