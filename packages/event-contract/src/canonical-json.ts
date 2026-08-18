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
      throw new TypeError("canonical JSON에는 유한한 숫자만 사용할 수 있습니다.");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError("canonical JSON에는 순환 참조를 사용할 수 없습니다.");
    ancestors.add(value);
    try {
      return `[${value.map((item) => serializeCanonical(item, ancestors)).join(",")}]`;
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value !== "object") {
    throw new TypeError(`canonical JSON으로 직렬화할 수 없는 값입니다: ${typeof value}`);
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("canonical JSON에는 일반 객체만 사용할 수 있습니다.");
  }
  if (ancestors.has(value)) throw new TypeError("canonical JSON에는 순환 참조를 사용할 수 없습니다.");
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
