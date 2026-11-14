"use strict";

const {
  fromEntries,
  SafeMap,
  SafeSet,
  stringify,
  toText,
} = require("./ci-test-input-intrinsics.cjs");

/**
 * One process's bounded observation (ADR-0565). Records hold repository-relative paths, package
 * keys, counts and closed codes only: never file contents, environment values or credentials.
 * Reaching a bound sets `truncated`, which the ledger treats as an incomplete module graph.
 */
const CI_TEST_INPUT_RECORD_SCHEMA = 2;

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
  args.slice(-maximumArguments).map((argument) => toText(argument).slice(0, maximumArgumentLength));

class CiTestInputRecord {
  #inputs = new SafeSet();
  #absent = new SafeSet();
  #listings = new SafeMap();
  #trees = new SafeSet();
  #writes = new SafeSet();
  #writesDropped = false;
  #dependencies = new SafeSet();
  #modules = new SafeSet();
  #host = new SafeSet();
  #children = [];
  #collapsed = new SafeMap();
  #external = new SafeSet();
  #notes = new SafeSet();
  #counts = {
    temporary: 0,
    host: 0,
    loopback: 0,
    localSocket: 0,
    external: 0,
    clockNow: 0,
    clockConstruct: 0,
    clockUnattributed: 0,
    childrenDropped: 0,
  };
  #pending = new SafeMap();
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

  /**
   * Records one classified path. `access` is `read`, `probe`, `list` (with `recursive` true, false
   * or `"unknown"`), `tree` or `write`. Read paths stay pending until `resolve`, so observing a call
   * never inspects its result. A write is recorded at once: repository paths and dependency keys
   * that any process changes make every other file's closure that touches them uncertain.
   */
  path({ kind, path }, access, absolute, recursive = false) {
    if (access === "write") {
      const key = kind === "git" ? `.git:${path}` : path;
      if (kind !== "repository" && kind !== "git" && kind !== "dependency") return;
      if (!this.#writes.has(key) && this.#writes.size >= maximumPaths) this.#writesDropped = true;
      this.#add(this.#writes, key);
      return;
    }
    if (kind === "temporary") this.#counts.temporary += 1;
    else if (kind === "host") {
      this.#counts.host += 1;
      this.#sample(this.#host, path);
    } else if (kind === "dependency") this.#add(this.#dependencies, path);
    else if (kind === "repository" || kind === "git") {
      const key = kind === "git" ? `.git:${path}` : path;
      let entry = this.#pending.get(key);
      if (entry === undefined) {
        if (this.#pending.size >= maximumPaths) {
          this.#truncated = true;
          return;
        }
        entry = { absolute, kind, accesses: new SafeSet(), resolved: false };
        this.#pending.set(key, entry);
      }
      const accesses =
        access !== "list"
          ? [access]
          : recursive === "unknown"
            ? ["list", "listRecursive"]
            : [recursive === true ? "listRecursive" : "list"];
      for (const each of accesses) {
        if (!entry.accesses.has(each)) entry.resolved = false;
        entry.accesses.add(each);
      }
    }
  }

  /**
   * Resolves pending paths against the filesystem as it is now: `exists(absolute)` and
   * `list(absolute, recursive)`, which returns a listing digest. A path that is gone is absent.
   * Plain and recursive listings are kept apart, because their digests mean different things.
   */
  resolve({ exists, list }) {
    for (const [key, entry] of this.#pending) {
      if (entry.resolved) continue;
      entry.resolved = true;
      if (!exists(entry.absolute)) {
        this.#add(this.#absent, key);
        continue;
      }
      this.#absent.delete(key);
      if (entry.accesses.has("tree")) this.#add(this.#trees, key);
      if (entry.accesses.has("read") || entry.accesses.has("probe")) this.#add(this.#inputs, key);
      for (const [access, kind] of [
        ["list", "plain"],
        ["listRecursive", "recursive"],
      ]) {
        if (!entry.accesses.has(access)) continue;
        if (entry.kind === "git") this.#add(this.#inputs, key);
        else {
          const listing = this.#listings.get(key) ?? {};
          listing[kind] = list(entry.absolute, kind === "recursive");
          this.#listings.set(key, listing);
        }
      }
    }
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
  child({ command, args, cwd, pid, inherited, synchronous, failed, bootstrap, startedAt }) {
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
    const key = collapsible ? stringify({ ...entry, pid: null }) : null;
    // Wall-clock start in milliseconds; a collapsed entry keeps the first, which is the earliest.
    entry.startedAt = startedAt ?? null;
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
      listings: fromEntries([...this.#listings].sort(([left], [right]) => (left < right ? -1 : 1))),
      trees: sorted(this.#trees),
      writes: sorted(this.#writes),
      writesDropped: this.#writesDropped,
      dependencies: sorted(this.#dependencies),
      host: sorted(this.#host),
      children: this.#children,
      external: sorted(this.#external),
      counts: { ...this.#counts },
      notes: sorted(this.#notes),
      truncated: this.#truncated,
    };
  }
}

module.exports = { CiTestInputRecord, ciTestInvocation };
