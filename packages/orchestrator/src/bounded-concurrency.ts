// A small limiter for filesystem work that must not open every file at once.

export type BoundedConcurrency = <T>(operation: () => Promise<T>) => Promise<T>;

/** Runs at most `limit` of the given operations at a time, in the order they were asked for. */
export function boundedConcurrency(limit: number): BoundedConcurrency {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    // A finishing operation hands its slot straight to the next waiter, so a new caller arriving
    // in between never finds a slot that is already promised.
    if (running >= limit) await new Promise<void>((proceed) => waiting.push(proceed));
    else running += 1;
    try {
      return await operation();
    } finally {
      const next = waiting.shift();
      if (next === undefined) running -= 1;
      else next();
    }
  };
}
