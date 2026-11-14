"use strict";

/**
 * Counts real-clock reads by test and product code (ADR-0565): `Date.now()` and `new Date()`
 * without arguments. A fake clock installs its own `Date` whose constructor always passes a
 * time, so reads under fake timers never reach these counters. Calls from dependencies and Node
 * internals are not counted. `performance.now()` and `process.hrtime()` are not observed.
 */
const maximumInspections = 5_000;

function installClockObserver({ observe, ownFiles }) {
  let inspections = 0;
  const captureCallSites = (_, callSites) => callSites;

  /** Reads at most a few frames, swapping in a raw formatter so source maps are not applied. */
  const fromCode = () => {
    const prepare = Error.prepareStackTrace;
    const limit = Error.stackTraceLimit;
    const holder = {};
    try {
      Error.prepareStackTrace = captureCallSites;
      Error.stackTraceLimit = 8;
      Error.captureStackTrace(holder, fromCode);
      for (const callSite of holder.stack ?? []) {
        const file = callSite.getFileName?.();
        if (file && ownFiles.has(file)) continue;
        return Boolean(file) && !file.startsWith("node:") && !file.includes("/node_modules/");
      }
      return false;
    } finally {
      Error.prepareStackTrace = prepare;
      Error.stackTraceLimit = limit;
    }
  };
  const report = (kind) => {
    try {
      if (inspections >= maximumInspections) return observe("unattributed");
      inspections += 1;
      if (fromCode()) observe(kind);
    } catch {
      // Observation never changes the observed call.
    }
  };

  const NativeDate = globalThis.Date;
  const now = NativeDate.now;
  NativeDate.now = function now_() {
    report("now");
    return now.call(this);
  };
  Object.defineProperty(NativeDate.now, "name", { value: "now" });
  const RecordingDate = new Proxy(NativeDate, {
    construct(target, args, newTarget) {
      if (args.length === 0) report("construct");
      return Reflect.construct(target, args, newTarget === RecordingDate ? target : newTarget);
    },
  });
  globalThis.Date = RecordingDate;
  // Keeps `new Date().constructor === Date` true for code that compares constructors.
  NativeDate.prototype.constructor = RecordingDate;
}

module.exports = { installClockObserver };
