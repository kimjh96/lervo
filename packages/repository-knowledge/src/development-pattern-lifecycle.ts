import type { DevelopmentPatternReview } from "./development-pattern-candidate.js";

export type DevelopmentPatternState =
  "observed" | "candidate" | "reviewed" | "promoted" | "rejected" | "deferred" | "superseded";

export interface DevelopmentPatternTransition {
  fromState: DevelopmentPatternState;
  toState: DevelopmentPatternState;
}

export interface DevelopmentPatternSupersessionCoordinate {
  patternId: string;
  state: string;
  targetKind: string;
  targetPath: string;
}

export function assertDevelopmentPatternSupersession(input: {
  current: DevelopmentPatternSupersessionCoordinate;
  replacement: DevelopmentPatternSupersessionCoordinate | undefined;
}): void {
  if (
    input.replacement === undefined ||
    input.replacement.patternId === input.current.patternId ||
    !["candidate", "reviewed", "promoted"].includes(input.replacement.state)
  )
    throw new Error("Supersession requires a distinct current replacement pattern.");
  if (
    input.replacement.targetKind !== input.current.targetKind ||
    input.replacement.targetPath !== input.current.targetPath
  )
    throw new Error("A superseding pattern must own the same exact target responsibility.");
}

function terminalState(
  decision: Exclude<DevelopmentPatternReview["decision"], "accept">,
): "rejected" | "deferred" | "superseded" {
  if (decision === "reject") return "rejected";
  if (decision === "defer") return "deferred";
  return "superseded";
}

export function developmentPatternReviewTransitions(input: {
  currentState: string;
  decision: DevelopmentPatternReview["decision"];
}): DevelopmentPatternTransition[] {
  if (input.currentState === "reviewed" || input.currentState === "promoted") {
    if (input.decision !== "supersede")
      throw new Error("A reviewed or promoted pattern permits only an exact supersession review.");
    return [{ fromState: input.currentState, toState: "superseded" }];
  }
  if (input.currentState !== "candidate" && input.currentState !== "deferred")
    throw new Error("The pattern is not reviewable from its current state.");
  const transitions: DevelopmentPatternTransition[] = [
    { fromState: input.currentState, toState: "reviewed" },
  ];
  if (input.decision !== "accept")
    transitions.push({ fromState: "reviewed", toState: terminalState(input.decision) });
  return transitions;
}
