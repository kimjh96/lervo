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
    const prepare = Object.getOwnPropertyDescriptor(Error, "prepareStackTrace");
    const limit = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
    // An accessor here is user code; reading or writing it would run that code.
    if ((prepare && !("value" in prepare)) || !limit || !("value" in limit) || !limit.writable)
      return null;
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
      if (prepare) Error.prepareStackTrace = prepare.value;
      else delete Error.prepareStackTrace;
      Error.stackTraceLimit = limit.value;
    }
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

  const NativeDate = globalThis.Date;
  // A Proxy keeps `Date.now` non-constructible, with its own name and length.
  NativeDate.now = new Proxy(NativeDate.now, {
    apply(target, self, args) {
      report("now");
      return Reflect.apply(target, self, args);
    },
  });
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
