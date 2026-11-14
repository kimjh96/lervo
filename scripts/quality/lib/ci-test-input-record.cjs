"use strict";

/**
 * One process's bounded observation (ADR-0565). Records hold repository-relative paths, package
 * keys, counts and closed codes only: never file contents, environment values or credentials.
 * Reaching a bound sets `truncated`, which the ledger treats as an incomplete module graph.
 */
const CI_TEST_INPUT_RECORD_SCHEMA = 1;

const maximumPaths = 50_000;
const maximumSamples = 64;
const maximumChildren = 2_000;
const maximumArgumentLength = 160;
const maximumArguments = 8;

/**
 * The bounded tail of a command line. A parent records its child's tail and the child records its
 * own, so the ledger can match a child that a synchronous API started without exposing its PID.
 */
const ciTestInvocation = (args) =>
  args.slice(-maximumArguments).map((argument) => String(argument).slice(0, maximumArgumentLength));

class CiTestInputRecord {
  #inputs = new Set();
  #absent = new Set();
  #directories = new Map();
  #trees = new Set();
  #dependencies = new Set();
  #modules = new Set();
  #host = new Set();
  #children = [];
  #collapsed = new Map();
  #external = new Set();
  #notes = new Set();
  #counts = {
    temporary: 0,
    host: 0,
    loopback: 0,
    localSocket: 0,
    external: 0,
    clockNow: 0,
    clockConstruct: 0,
    clockUnattributed: 0,
    sqliteOpened: 0,
    childrenDropped: 0,
  };
  #sqlite = new Set();
  #truncated = false;

  constructor(identity) {
    this.identity = identity;
    this.file = null;
  }

  #add(set, value) {
    if (set.has(value)) return;
    if (set.size >= maximumPaths) {
      this.#truncated = true;
      return;
    }
    set.add(value);
  }

  #sample(set, value) {
    if (set.size < maximumSamples) set.add(value);
  }

  /** Records one classified path; `access` is `read`, `probe`, `absent` or `tree`. */
  path({ kind, path }, access) {
    if (kind === "temporary") this.#counts.temporary += 1;
    else if (kind === "host") {
      this.#counts.host += 1;
      this.#sample(this.#host, path);
    } else if (kind === "dependency") this.#add(this.#dependencies, path);
    else if (kind === "repository" || kind === "git") {
      const key = kind === "git" ? `.git:${path}` : path;
      if (access === "absent") this.#add(this.#absent, key);
      else if (access === "tree") this.#add(this.#trees, key);
      else this.#add(this.#inputs, key);
    }
  }

  directory({ kind, path }, digest) {
    if (kind !== "repository") return this.path({ kind, path }, "read");
    if (this.#directories.size >= maximumPaths && !this.#directories.has(path))
      this.#truncated = true;
    // The same directory listed twice with different contents keeps its first and latest digests.
    else if (!this.#directories.has(path)) this.#directories.set(path, [digest]);
    else if (this.#directories.get(path).at(-1) !== digest) this.#directories.get(path)[1] = digest;
  }

  /** Records a module path that a loader observed without a filesystem read, such as vite-node. */
  module({ kind, path }) {
    if (kind === "repository") this.#add(this.#modules, path);
    else this.path({ kind, path }, "read");
  }

  /**
   * A child that cannot have its own record, Git or one started without the recorder, needs no
   * PID to be matched, so identical ones collapse into one entry with a count.
   */
  child({ command, args, cwd, pid, inherited, synchronous, failed, bootstrap }) {
    const entry = {
      command,
      args: ciTestInvocation(args),
      cwd,
      pid: pid ?? null,
      inherited,
      synchronous,
      failed,
      bootstrap,
      count: 1,
    };
    const collapsible = command === "git" || !inherited || failed;
    const key = collapsible ? JSON.stringify({ ...entry, pid: null }) : null;
    if (key !== null && this.#collapsed.has(key)) {
      this.#collapsed.get(key).count += 1;
      return;
    }
    if (this.#children.length >= maximumChildren) {
      this.#counts.childrenDropped += 1;
      this.#truncated = true;
      return;
    }
    if (key !== null) {
      entry.pid = null;
      this.#collapsed.set(key, entry);
    }
    this.#children.push(entry);
  }

  connection(kind, endpoint) {
    if (kind === "external") {
      this.#counts.external += 1;
      this.#sample(this.#external, endpoint);
    } else if (kind === "loopback") this.#counts.loopback += 1;
    else this.#counts.localSocket += 1;
  }

  clock(kind) {
    if (kind === "now") this.#counts.clockNow += 1;
    else if (kind === "construct") this.#counts.clockConstruct += 1;
    else this.#counts.clockUnattributed += 1;
  }

  sqlite(location) {
    this.#counts.sqliteOpened += 1;
    if (location) this.#sample(this.#sqlite, location);
  }

  note(code) {
    this.#notes.add(code);
  }

  toJSON() {
    const sorted = (values) => [...values].sort();
    return {
      schemaVersion: CI_TEST_INPUT_RECORD_SCHEMA,
      ...this.identity,
      file: this.file,
      inputs: sorted(this.#inputs),
      modules: sorted(this.#modules),
      absent: sorted(this.#absent),
      directories: Object.fromEntries(
        [...this.#directories].sort(([left], [right]) => (left < right ? -1 : 1)),
      ),
      trees: sorted(this.#trees),
      dependencies: sorted(this.#dependencies),
      host: sorted(this.#host),
      children: this.#children,
      external: sorted(this.#external),
      sqlite: sorted(this.#sqlite),
      counts: { ...this.#counts },
      notes: sorted(this.#notes),
      truncated: this.#truncated,
    };
  }
}

module.exports = { CiTestInputRecord, ciTestInvocation };
