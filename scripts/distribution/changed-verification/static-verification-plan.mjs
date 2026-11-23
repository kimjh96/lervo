/**
 * Whether a change can alter the result of a repository-wide static check (lint or typecheck).
 * The isolated verification workspace holds a candidate's changes on top of a base that already
 * passed both checks, so a change made only of Markdown and Lervo state cannot change either
 * result. Anything else, including configuration, lockfiles, and every code file, runs the full
 * check, exactly as before.
 */
const CODE = /\.(?:c|m)?[jt]sx?$/u;

export function staticCheckUnaffected(changedPaths) {
  return changedPaths.every(
    (path) =>
      path.endsWith(".md") ||
      (path.startsWith(".lervo/") && !path.startsWith(".lervo/verifications/") && !CODE.test(path)),
  );
}
