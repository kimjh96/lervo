"use strict";

const util = require("node:util");

const { types } = util;

/**
 * Built-ins captured once, when the recorder is preloaded and before any test code runs
 * (ADR-0565). Recorder hooks run inside the observed program, which may replace globals such as
 * `Error`, `Object`, `Reflect`, `Date` or `process.cwd`, or turn their properties into getters.
 * Hooks therefore use only these captures; `ci-test-input-transparency.test.mjs` fails when a
 * recorder function body names one of those globals. Built-in prototype methods, such as
 * `String.prototype.startsWith`, are still looked up when called.
 */
module.exports = Object.freeze({
  apply: Reflect.apply,
  arrayFrom: Array.from,
  construct: Reflect.construct,
  cwd: process.cwd,
  defineProperty: Object.defineProperty,
  entries: Object.entries,
  fromEntries: Object.fromEntries,
  getBuiltinModule: process.getBuiltinModule,
  getCallSites: util.getCallSites,
  getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  getPrototypeOf: Object.getPrototypeOf,
  global: globalThis,
  hasOwn: Object.hasOwn,
  hrefGetter: Object.getOwnPropertyDescriptor(URL.prototype, "href").get,
  hrtime: process.hrtime.bigint,
  isArray: Array.isArray,
  isModuleNamespaceObject: types.isModuleNamespaceObject,
  isProxy: types.isProxy,
  isUint8Array: types.isUint8Array,
  NativeDate: Date,
  // The clock observer later wraps `Date.now`; the recorder's own timestamps use the original.
  wallClock: Date.now,
  NativeError: Error,
  ProxyConstructor: Proxy,
  processObject: process,
  SafeMap: Map,
  SafeSet: Set,
  stringify: JSON.stringify,
  toText: String,
  // A Buffer path names the file its bytes spell; invalid UTF-8 throws instead of guessing.
  utf8Decode: TextDecoder.prototype.decode,
  utf8Decoder: new TextDecoder("utf-8", { fatal: true }),
  values: Object.values,
});
