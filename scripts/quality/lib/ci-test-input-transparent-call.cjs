"use strict";

const {
  apply,
  defineProperty,
  getOwnPropertyDescriptor,
  getPrototypeOf,
  hasOwn,
  hrefGetter,
  isProxy,
  NativeError,
  ProxyConstructor,
} = require("./ci-test-input-intrinsics.cjs");

/**
 * Transparency rules shared by every recorder observer (ADR-0565):
 *
 * - A wrapped function is a Proxy of the original, so its name, length, prototype,
 *   constructibility and own properties stay the original's. Construction is not trapped, and
 *   the prototype's `constructor` points at the Proxy, as it pointed at the original.
 * - Hooks run guarded and see only values that cannot run user code: primitives, own data
 *   properties of objects that are not Proxies, and URL fields read through URL's own getter.
 *   They never read a getter, call `toString`, or touch the result promise or callbacks.
 * - Hooks use only built-ins captured at preload, never globals looked up at call time.
 * - Each call adds exactly one recorder frame. The intrinsic `Error.stackTraceLimit` rises by
 *   one during the call so the caller's frames still fit, and is restored only when the call
 *   left it unchanged.
 */

/** An own data property of a non-Proxy object, or `undefined`; never runs user code. */
function ownData(object, key) {
  if (object === null || (typeof object !== "object" && typeof object !== "function"))
    return undefined;
  if (isProxy(object)) return undefined;
  const descriptor = getOwnPropertyDescriptor(object, key);
  return descriptor !== undefined && hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

/** Like `ownData`, but distinguishes a missing property from one the hook cannot read. */
function ownDataState(object, key) {
  if (object === null || (typeof object !== "object" && typeof object !== "function"))
    return { known: true, value: undefined };
  if (isProxy(object)) return { known: false };
  const descriptor = getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) return { known: !inheritsProperty(object, key), value: undefined };
  return hasOwn(descriptor, "value") ? { known: true, value: descriptor.value } : { known: false };
}

/** Whether a property would come from a prototype; a Proxy prototype counts as unknown. */
function inheritsProperty(object, key) {
  for (let prototype = getPrototypeOf(object); prototype !== null;) {
    if (isProxy(prototype)) return true;
    if (getOwnPropertyDescriptor(prototype, key) !== undefined)
      return getPrototypeOf(prototype) !== null;
    prototype = getPrototypeOf(prototype);
  }
  return false;
}

/** A path argument as a string: a primitive string, or a WHATWG URL read through its own getter. */
function pathText(value) {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object" || isProxy(value)) return null;
  try {
    return apply(hrefGetter, value, []);
  } catch {
    return null;
  }
}

function writableLimit() {
  const descriptor = getOwnPropertyDescriptor(NativeError, "stackTraceLimit");
  return descriptor !== undefined &&
    hasOwn(descriptor, "value") &&
    descriptor.writable &&
    typeof descriptor.value === "number"
    ? descriptor.value
    : null;
}

function guarded(hook, first, second, third) {
  if (hook === undefined) return undefined;
  try {
    return hook(first, second, third);
  } catch {
    return undefined;
  }
}

/** Raises the intrinsic limit by this wrapper's frame; returns the previous value, or `null`. */
function raiseLimit() {
  try {
    const limit = writableLimit();
    if (limit !== null) NativeError.stackTraceLimit = limit + 1;
    return limit;
  } catch {
    return null;
  }
}

function restoreLimit(limit) {
  try {
    if (limit !== null && writableLimit() === limit + 1) NativeError.stackTraceLimit = limit;
  } catch {
    // A limit the call made unreadable stays as the call left it.
  }
}

/**
 * Wraps `original` with guarded hooks: `before(args, self)` returns a context, `after(context,
 * result, self)` runs on return and `thrown(context, error, self)` on throw.
 */
function observeCalls(original, { before, after, thrown }) {
  const proxy = new ProxyConstructor(original, {
    apply(target, self, args) {
      const context = guarded(before, args, self);
      const limit = raiseLimit();
      let result;
      try {
        result = apply(target, self, args);
      } catch (error) {
        restoreLimit(limit);
        guarded(thrown, context, error, self);
        throw error;
      }
      restoreLimit(limit);
      guarded(after, context, result, self);
      return result;
    },
  });
  const prototype = ownData(original, "prototype");
  const constructor =
    prototype !== undefined && prototype !== null
      ? getOwnPropertyDescriptor(prototype, "constructor")
      : undefined;
  if (constructor?.value === original && constructor.writable)
    defineProperty(prototype, "constructor", { ...constructor, value: proxy });
  return proxy;
}

module.exports = { observeCalls, ownData, ownDataState, pathText };
