import { open, stat, truncate, writeFile } from "node:fs/promises";

export const MAXIMUM_SERVICE_LOG_BYTES = 4 * 1024 * 1024;
const BOUND_INTERVAL_MS = 10 * 60_000;

/**
 * Keeps a launchd-appended service log under its bound: the newest bytes move to `<path>.1` and
 * the file is truncated in place. launchd writes with O_APPEND, so writes continue at the new end.
 */
export async function boundServiceLog(path: string, maximumBytes = MAXIMUM_SERVICE_LOG_BYTES) {
  const size = await stat(path).then(
    (metadata) => (metadata.isFile() ? metadata.size : 0),
    () => 0,
  );
  if (size <= maximumBytes) return false;
  // The previous generation keeps only the newest bytes, so both generations stay bounded.
  const tail = Buffer.alloc(maximumBytes);
  const handle = await open(path, "r");
  try {
    await handle.read(tail, 0, maximumBytes, size - maximumBytes);
  } finally {
    await handle.close();
  }
  await writeFile(`${path}.1`, tail, { mode: 0o600 });
  await truncate(path, 0);
  return true;
}

/** Bounds the log now and periodically; the returned function stops the timer. */
export function keepServiceLogBounded(path: string): () => void {
  const run = () => void boundServiceLog(path).catch(() => undefined);
  run();
  const timer = setInterval(run, BOUND_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
