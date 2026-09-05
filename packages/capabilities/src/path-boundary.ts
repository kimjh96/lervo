import * as nativePath from "node:path";

interface PathOperations {
  readonly sep: string;
  isAbsolute(path: string): boolean;
  relative(from: string, to: string): string;
}

export function isPathInsideDirectory(
  directory: string,
  candidate: string,
  paths: PathOperations = nativePath,
): boolean {
  const child = paths.relative(directory, candidate);
  return (
    child !== "" &&
    child !== ".." &&
    !child.startsWith(`..${paths.sep}`) &&
    !paths.isAbsolute(child)
  );
}
