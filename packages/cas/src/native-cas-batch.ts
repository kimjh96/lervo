import type { NativeCas, NativeCasOperation, NativeCasResult } from "./native-cas.js";

type Pending = {
  operation: NativeCasOperation;
  resolve: (result: NativeCasResult | undefined) => void;
  reject: (error: unknown) => void;
};
const syscalls = new Set(["mkdir", "lstat", "link", "open", "fstat", "read", "close"]);

function validResult(value: NativeCasResult | undefined, operation: NativeCasOperation): boolean {
  if (!value || typeof value.created !== "boolean" || (operation.length === 1 && value.created))
    return false;
  switch (value.status) {
    case "complete":
      return Buffer.isBuffer(value.bytes) && value.bytes.byteLength <= 65536;
    case "large":
      return true;
    case "failed":
      return (
        ["system_error", "unsafe_path"].includes(value.code) &&
        Number.isInteger(value.errno) &&
        value.errno >= (value.code === "system_error" ? 1 : 0) &&
        value.errno <= 2147483647 &&
        syscalls.has(value.syscall) &&
        Number.isInteger(value.pathIndex) &&
        value.pathIndex >= 0 &&
        value.pathIndex < operation.length
      );
    default:
      return false;
  }
}

/** A result of undefined selects ordinary I/O only when native work was not admitted. */
export function createNativeCasBatch(native: NativeCas) {
  let pending = 0;
  let queued: Pending[] = [];
  const dispatch = () => {
    const group = queued;
    queued = [];
    const fail = (error: unknown) => {
      pending -= group.length;
      for (const item of group) item.reject(error);
    };
    let work: Promise<NativeCasResult[]>;
    try {
      work = native.batch(group.map((item) => item.operation));
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === "native_cas_capacity") {
        pending -= group.length;
        for (const item of group) item.resolve(undefined);
      } else fail(error);
      return;
    }
    void Promise.resolve(work).then((results) => {
      try {
        if (
          !Array.isArray(results) ||
          results.length !== group.length ||
          !group.every((item, index) => validResult(results[index], item.operation))
        ) {
          throw Object.assign(new Error("Invalid native CAS results."), {
            code: "native_cas_invalid_result",
          });
        }
      } catch (error) {
        fail(error);
        return;
      }
      pending -= group.length;
      for (const [index, item] of group.entries()) item.resolve(results[index]!);
    }, fail);
  };
  return (operation: NativeCasOperation): Promise<NativeCasResult | undefined> => {
    if (
      pending >= 16 ||
      operation.some(
        (path) => !path.startsWith("/") || path.includes("\0") || Buffer.byteLength(path) >= 4096,
      )
    )
      return Promise.resolve(undefined);
    const snapshot: NativeCasOperation =
      operation.length === 1 ? [operation[0]] : [operation[0], operation[1], operation[2]];
    pending++;
    return new Promise((resolve, reject) => {
      queued.push({ operation: snapshot, resolve, reject });
      if (queued.length === 1) setImmediate(dispatch);
    });
  };
}
