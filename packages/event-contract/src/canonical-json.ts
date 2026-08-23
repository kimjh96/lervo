type JsonPrimitive = boolean | number | string | null;
export type CanonicalJsonValue =
  | JsonPrimitive
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function serializeCanonical(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON accepts only finite numbers.");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError("Canonical JSON does not allow cyclic references.");
    ancestors.add(value);
    try {
      return `[${value.map((item) => serializeCanonical(item, ancestors)).join(",")}]`;
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value !== "object") {
    throw new TypeError(`Value cannot be serialized as canonical JSON: ${typeof value}`);
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Canonical JSON accepts only plain objects.");
  }
  if (ancestors.has(value)) throw new TypeError("Canonical JSON does not allow cyclic references.");
  ancestors.add(value);
  const record = value as Record<string, unknown>;
  try {
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeCanonical(record[key], ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return serializeCanonical(value, new WeakSet<object>());
}
