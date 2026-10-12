// Keys are generated schema arrays, never request values or observed repository state.
const indexes = new WeakMap<readonly unknown[], ReadonlySet<unknown>>();

export function enumContains(value: unknown, values: readonly unknown[]): boolean {
  let index = indexes.get(values);
  if (!index) {
    index = new Set(values);
    indexes.set(values, index);
  }
  return index.has(value);
}
