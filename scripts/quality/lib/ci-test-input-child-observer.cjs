"use strict";

const { types } = require("node:util");

const {
  observeCalls,
  ownData,
  ownDataState,
  pathText,
} = require("./ci-test-input-transparent-call.cjs");

/**
 * Translates child process creation into observations (ADR-0565). Asynchronous APIs all reach
 * `ChildProcess.prototype.spawn` with options Node has already normalized; each synchronous API
 * is wrapped at its public name and read without running user code. A value that would need a
 * getter, a Proxy trap or a string conversion is reported as unknown instead. Observations carry
 * only the variables that decide whether the child inherits the recorder, never the environment.
 */
const inheritedVariables = [
  "NODE_OPTIONS",
  "LERVO_CI_TEST_LEDGER",
  "LERVO_CI_TEST_LEDGER_DIRECTORY",
];

/** Reads the variables as Node would: own enumerable keys only, primitive values only. */
function fromObject(env) {
  if (types.isProxy(env)) return null;
  const values = {};
  for (const name of inheritedVariables) {
    const descriptor = Object.getOwnPropertyDescriptor(env, name);
    if (!descriptor || !descriptor.enumerable) continue;
    if (!("value" in descriptor)) return null;
    const { value } = descriptor;
    if (value !== null && (typeof value === "object" || typeof value === "function")) return null;
    values[name] = `${value}`;
  }
  return values;
}

function fromPairs(pairs) {
  if (!Array.isArray(pairs)) return null;
  const values = {};
  for (const pair of pairs) {
    const separator = typeof pair === "string" ? pair.indexOf("=") : -1;
    const name = separator > 0 ? pair.slice(0, separator) : null;
    if (inheritedVariables.includes(name)) values[name] = pair.slice(separator + 1);
  }
  return values;
}

/** String elements of a non-Proxy array; any other element is shown, never converted. */
function argumentList(values) {
  if (!Array.isArray(values) || types.isProxy(values)) return [];
  const length = ownData(values, "length") ?? 0;
  return Array.from({ length }, (_, index) => {
    const value = ownData(values, index);
    return typeof value === "string" ? value : "<unread>";
  });
}

/** Mirrors Node's optional `args` and `options` positions for the synchronous APIs. */
function describeFile(file, maybeArgs, maybeOptions) {
  const args = Array.isArray(maybeArgs) ? maybeArgs : undefined;
  const options = args === undefined ? (maybeArgs ?? maybeOptions) : maybeOptions;
  const env = ownDataState(options, "env");
  const cwd = ownDataState(options, "cwd");
  return {
    file: typeof file === "string" ? file : "<unread>",
    args: argumentList(args),
    // `undefined` runs in this process's directory; `null` is a directory the hook cannot read.
    cwd: !cwd.known ? null : cwd.value == null ? undefined : pathText(cwd.value),
    environment: !env.known ? null : env.value ? fromObject(env.value) : fromObject(process.env),
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
