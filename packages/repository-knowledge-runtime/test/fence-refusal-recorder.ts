/**
 * The stack of every `source_bytes_changed` refusal raised in this test process, in order. A
 * sweep attributes each refusal to the fence whose stack raised it, so a later decision check
 * that refuses is never credited to an exact fence.
 */
export const fenceRefusalLog: string[] = [];

/** `failure.js` with an error class that records each source refusal as it is raised. */
export function recordingFailureModule<T extends typeof import("../src/failure.js")>(actual: T): T {
  class RecordingKnowledgeConvergenceRuntimeError extends actual.KnowledgeConvergenceRuntimeError {
    constructor(code: string, options?: ErrorOptions) {
      super(code, options);
      if (code === "source_bytes_changed") fenceRefusalLog.push(this.stack ?? "");
    }
  }
  return { ...actual, KnowledgeConvergenceRuntimeError: RecordingKnowledgeConvergenceRuntimeError };
}
