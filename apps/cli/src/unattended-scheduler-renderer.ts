import type { UnattendedSchedulerResultV1 } from "@lervo/application-contract";

export function renderUnattendedSchedulerResult(
  result: UnattendedSchedulerResultV1,
  json: boolean,
): { channel: "stdout" | "stderr"; output: string; exitCode: number } {
  const successful = result.status !== "attention_required";
  const output = json
    ? `${JSON.stringify(result, null, 2)}\n`
    : [
        `Unattended scheduler: ${result.status} (${result.reasonCode})`,
        `cycles: ${result.counts.cycles}; claims: ${result.counts.claims}; managed runs: ${result.counts.managedRuns}; completed: ${result.counts.completedAssignments}`,
        `last decision: ${result.lastSelection?.kind ?? "none"}${result.lastSelection?.assignmentId === null || result.lastSelection?.assignmentId === undefined ? "" : ` ${result.lastSelection.assignmentId}`}`,
        "",
      ].join("\n");
  return { channel: successful ? "stdout" : "stderr", output, exitCode: successful ? 0 : 1 };
}
