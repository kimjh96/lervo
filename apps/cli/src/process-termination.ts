/** Resolves on the first SIGINT or SIGTERM, then stops listening for both. */
export function untilTerminated(): Promise<void> {
  return new Promise<void>((resolve) => {
    const stopped = () => {
      process.removeListener("SIGINT", stopped);
      process.removeListener("SIGTERM", stopped);
      resolve();
    };
    process.once("SIGINT", stopped);
    process.once("SIGTERM", stopped);
  });
}
