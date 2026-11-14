"use strict";

const {
  apply,
  construct,
  getCallSites,
  global,
  NativeDate,
  ProxyConstructor,
} = require("./ci-test-input-intrinsics.cjs");

/**
 * Counts real-clock reads by test and product code (ADR-0565): `Date.now()` and `new Date()`
 * without arguments. A fake clock installs its own `Date` whose constructor always passes a
 * time, so reads under fake timers never reach these counters. Calls from dependencies and Node
 * internals are not counted. `performance.now()` and `process.hrtime()` are not observed.
 */
const maximumInspections = 5_000;

function installClockObserver({ observe, ownFiles }) {
  let inspections = 0;

  /**
   * Reads at most a few frames through `util.getCallSites`, which creates no Error, so neither
   * `Error.prepareStackTrace` nor `Error.stackTraceLimit` is read or written.
   */
  const fromCode = () => {
    if (typeof getCallSites !== "function") return null;
    for (const callSite of getCallSites(8)) {
      const file = callSite.scriptName;
      if (file === "" || ownFiles.has(file)) continue;
      return !!file && !file.startsWith("node:") && !file.includes("/node_modules/");
    }
    return false;
  };
  const report = (kind) => {
    try {
      if (inspections >= maximumInspections) return observe("unattributed");
      inspections += 1;
      const attributed = fromCode();
      if (attributed === null) observe("unattributed");
      else if (attributed) observe(kind);
    } catch {
      // Observation never changes the observed call.
    }
  };

  // A Proxy keeps `Date.now` non-constructible, with its own name and length.
  NativeDate.now = new ProxyConstructor(NativeDate.now, {
    apply(target, self, args) {
      report("now");
      return apply(target, self, args);
    },
  });
  // Construction is forwarded unchanged, so `new.target` and the prototype stay the caller's.
  const RecordingDate = new ProxyConstructor(NativeDate, {
    construct(target, args, newTarget) {
      if (args.length === 0) report("construct");
      return construct(target, args, newTarget === RecordingDate ? target : newTarget);
    },
  });
  global.Date = RecordingDate;
  // Keeps `new Date().constructor === Date` true for code that compares constructors.
  NativeDate.prototype.constructor = RecordingDate;
}

module.exports = { installClockObserver };
