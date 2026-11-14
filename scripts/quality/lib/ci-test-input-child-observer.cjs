"use strict";

/**
 * Translates child process creation into observations (ADR-0565). Asynchronous APIs all reach
 * `ChildProcess.prototype.spawn`; each synchronous API is wrapped once at its public name because
 * Node calls its internal spawn directly. Observations carry only the variables that decide
 * whether the child inherits the recorder, never the environment itself.
 */
const inheritedVariables = [
  "NODE_OPTIONS",
  "LERVO_CI_TEST_LEDGER",
  "LERVO_CI_TEST_LEDGER_DIRECTORY",
];

function fromObject(env) {
  const source = env ?? process.env;
  return Object.fromEntries(inheritedVariables.map((name) => [name, source[name]]));
}

function fromPairs(pairs) {
  if (!Array.isArray(pairs)) return fromObject(undefined);
  const values = {};
  for (const pair of pairs) {
    const separator = typeof pair === "string" ? pair.indexOf("=") : -1;
    const name = separator > 0 ? pair.slice(0, separator) : null;
    if (inheritedVariables.includes(name)) values[name] = pair.slice(separator + 1);
  }
  return values;
}

/** Mirrors Node's optional `args` and `options` positions for the synchronous APIs. */
function fileArguments(args, options) {
  return Array.isArray(args) ? { args, options } : { args: [], options: args ?? options };
}

function installChildProcessObserver({ childProcess, observe }) {
  const report = (entry) => {
    try {
      observe(entry);
    } catch {
      // Observation never changes the observed call.
    }
  };

  const prototypeSpawn = childProcess.ChildProcess.prototype.spawn;
  childProcess.ChildProcess.prototype.spawn = function spawn(options) {
    const result = prototypeSpawn.call(this, options);
    report({
      file: options?.file,
      args: Array.isArray(options?.args) ? options.args.slice(1) : [],
      cwd: options?.cwd,
      environment: fromPairs(options?.envPairs),
      pid: this.pid,
      synchronous: false,
      failed: this.pid === undefined,
    });
    return result;
  };

  const spawnSync = childProcess.spawnSync;
  childProcess.spawnSync = function (file, maybeArgs, maybeOptions) {
    const result = spawnSync.apply(this, arguments);
    const { args, options } = fileArguments(maybeArgs, maybeOptions);
    report({
      file,
      args,
      cwd: options?.cwd,
      environment: fromObject(options?.env),
      pid: result?.pid || undefined,
      synchronous: true,
      failed: !result?.pid,
    });
    return result;
  };

  const synchronous = (name, describe) => {
    const original = childProcess[name];
    childProcess[name] = function () {
      const entry = describe(...arguments);
      try {
        const result = original.apply(this, arguments);
        report({ ...entry, failed: false });
        return result;
      } catch (error) {
        // A child that ran and exited non-zero still ran; only a failed launch has no `status`.
        report({ ...entry, failed: error?.status === undefined && error?.signal == null });
        throw error;
      }
    };
  };
  synchronous("execFileSync", (file, maybeArgs, maybeOptions) => {
    const { args, options } = fileArguments(maybeArgs, maybeOptions);
    return {
      file,
      args,
      cwd: options?.cwd,
      environment: fromObject(options?.env),
      synchronous: true,
    };
  });
  synchronous("execSync", (command, options) => ({
    file: typeof options?.shell === "string" ? options.shell : "/bin/sh",
    args: ["-c", command],
    cwd: options?.cwd,
    environment: fromObject(options?.env),
    synchronous: true,
  }));
}

module.exports = { installChildProcessObserver };
