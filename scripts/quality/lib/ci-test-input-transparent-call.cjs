"use strict";

const { types } = require("node:util");

/**
 * Transparency rules shared by every recorder observer (ADR-0565):
 *
 * - A wrapped function is a Proxy of the original, so its name, length, prototype,
 *   constructibility and own properties stay the original's. Construction is not trapped.
 * - Hooks run guarded and see only values that cannot run user code: primitives, own data
 *   properties of objects that are not Proxies, and URL fields read through URL's own getters.
 *   They never read a getter, call `toString`, or touch the result promise or callbacks.
 * - Each call adds exactly one recorder frame. The limit rises by one during the call so the
 *   caller's own frames still fit in a stack captured inside it, and is restored only when the
 *   call left it unchanged.
 */
const hrefGetter = Object.getOwnPropertyDescriptor(URL.prototype, "href").get;

/** An own data property of a non-Proxy object, or `undefined`; never runs user code. */
function ownData(object, key) {
  if (object === null || (typeof object !== "object" && typeof object !== "function"))
    return undefined;
  if (types.isProxy(object)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/** Like `ownData`, but distinguishes a property Node would read from one that is missing. */
function ownDataState(object, key) {
  if (object === null || (typeof object !== "object" && typeof object !== "function"))
    return { known: true, value: undefined };
  if (types.isProxy(object)) return { known: false };
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return { known: !inheritsProperty(object, key), value: undefined };
  return "value" in descriptor ? { known: true, value: descriptor.value } : { known: false };
}

/** Whether a property would come from a prototype; prototypes that are Proxies count as unknown. */
function inheritsProperty(object, key) {
  for (let prototype = Object.getPrototypeOf(object); prototype !== null;) {
    if (types.isProxy(prototype)) return true;
    if (Object.getOwnPropertyDescriptor(prototype, key)) return prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

/** A path argument as a string: a primitive string, or a WHATWG URL read through its own getter. */
function pathText(value) {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object" || types.isProxy(value)) return null;
  try {
    return hrefGetter.call(value);
  } catch {
    return null;
  }
}

function writableLimit() {
  const descriptor = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
  return descriptor &&
    "value" in descriptor &&
    descriptor.writable &&
    typeof descriptor.value === "number"
    ? descriptor.value
    : null;
}

/**
 * Wraps `original` with guarded hooks: `before(args, self)` returns a context, `after(context,
 * result, self)` runs on return and `thrown(context, error, self)` on throw.
 */
function observeCalls(original, { before, after, thrown }) {
  const guarded = (hook, ...values) => {
    if (hook === undefined) return undefined;
    try {
      return hook(...values);
    } catch {
      return undefined;
    }
  };
  return new Proxy(original, {
    apply(target, self, args) {
      const context = guarded(before, args, self);
      const limit = writableLimit();
      if (limit !== null) Error.stackTraceLimit = limit + 1;
      let result;
      try {
        result = Reflect.apply(target, self, args);
      } catch (error) {
        if (limit !== null && writableLimit() === limit + 1) Error.stackTraceLimit = limit;
        guarded(thrown, context, error, self);
        throw error;
      }
      if (limit !== null && writableLimit() === limit + 1) Error.stackTraceLimit = limit;
      guarded(after, context, result, self);
      return result;
    },
  });
}

module.exports = { observeCalls, ownData, ownDataState, pathText };
