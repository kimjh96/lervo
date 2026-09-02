import type {
  AssignmentCommunicationReportV1,
  GovernedWorkReportV1,
  OperatingObjectiveReportV1,
} from "@lervo/application-contract";

import { projectOperatingBoard } from "./project-operating-board.js";
import { renderOperatingBoardHtml } from "./render-operating-board.js";

export function renderGovernedWorkBoard(
  report: GovernedWorkReportV1,
  objective: OperatingObjectiveReportV1 | null = null,
  communications: AssignmentCommunicationReportV1 | null = null,
): string {
  return renderOperatingBoardHtml(projectOperatingBoard(report, objective, communications));
}

export { projectObservedBudgets, projectOperatingBoard } from "./project-operating-board.js";
export { renderOperatingBoardHtml } from "./render-operating-board.js";
export {
  formatAssignmentInbox,
  formatAssignmentThreads,
} from "./render-assignment-communication-text.js";
export { formatObservedBudgets, formatOperatingObjective } from "./render-operating-text.js";
export type {
  OperatingBudgetGroupV1,
  OperatingBoardNodeV1,
  OperatingBoardSummaryV1,
  OperatingBoardViewV1,
} from "./types.js";
