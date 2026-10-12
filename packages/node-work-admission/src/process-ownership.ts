import { NodeWorkAdmissionError } from "./contract.js";
import type { ProcessObservation } from "./process-observation.js";

function identity(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^proc_[a-z0-9_]{1,64}:sha256:[a-f0-9]{64}$/u.test(value))
    throw new NodeWorkAdmissionError("admission_invalid", "The Node process identity is invalid.");
  return value;
}

/** Absence or changed birth evidence releases ownership; uncertainty never does. */
export class ProcessOwnership {
  constructor(private readonly observe: (pid: number) => ProcessObservation) {}

  snapshot(pid: number): ProcessOwnership {
    const current = this.observe(pid);
    return new ProcessOwnership((requested) =>
      requested === pid ? current : { status: "unknown" },
    );
  }

  capture(pid: number): string {
    const current = this.observe(pid);
    if (current.status !== "present")
      throw new NodeWorkAdmissionError(
        "admission_invalid",
        "The Node process identity could not be established.",
      );
    const value = identity(current.identity);
    if (value === null)
      throw new NodeWorkAdmissionError("admission_invalid", "The Node process identity is absent.");
    return value;
  }

  isStale(pid: number, stored: unknown): boolean {
    const previous = identity(stored);
    const current = this.observe(pid);
    if (current.status === "absent") return true;
    if (current.status !== "present") return false;
    const observed = identity(current.identity);
    return (
      previous !== null &&
      observed !== null &&
      previous.split(":", 1)[0] === observed.split(":", 1)[0] &&
      previous !== observed
    );
  }

  matches(pid: number, stored: unknown): boolean {
    const previous = identity(stored);
    const current = this.observe(pid);
    return (
      previous !== null && current.status === "present" && identity(current.identity) === previous
    );
  }
}
