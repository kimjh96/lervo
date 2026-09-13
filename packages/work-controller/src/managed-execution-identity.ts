import { operatingContractHash } from "./operating-mandate-admission.js";

/** A caller-selected execution key names one attempt; it never authorizes a second launch. */
export function managedExecutionIdentity(projectId: string, executionKey: string) {
  if (
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(projectId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(executionKey)
  )
    throw new TypeError("The managed execution identity is invalid.");
  const suffix = operatingContractHash({
    kind: "managed.execution.v1",
    projectId,
    executionKey,
  }).slice(7, 39);
  return { runId: `run_${suffix}`, sessionId: `ses_${suffix}` };
}
