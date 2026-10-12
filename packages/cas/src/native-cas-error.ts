import { getSystemErrorName } from "node:util";
import { CasError } from "./cas-error.js";
import type { NativeCasFailure, NativeCasOperation } from "./native-cas.js";

export function nativeCasError(
  operation: NativeCasOperation,
  failure: NativeCasFailure,
  uri: string,
): Error {
  if (failure.code === "unsafe_path")
    return new CasError("unsafe_path", "A CAS path must retain its expected type and identity.");
  const code = getSystemErrorName(-failure.errno);
  if (
    code === "ENOENT" &&
    failure.syscall === "lstat" &&
    failure.pathIndex === operation.length - 1
  )
    return new CasError("not_found", `CAS object not found: ${uri}`);
  return Object.assign(new Error(`${code}: CAS ${failure.syscall} failed.`), {
    code,
    errno: -failure.errno,
    syscall: failure.syscall,
    path: operation[failure.pathIndex],
    ...(failure.syscall === "link" && operation.length === 3 ? { dest: operation[2] } : {}),
  });
}
