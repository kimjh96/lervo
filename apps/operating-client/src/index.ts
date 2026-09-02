import type { GovernedWorkReportV1 } from "@lervo/application-contract";

import { projectOperatingBoard } from "./project-operating-board.js";
import { renderOperatingBoardHtml } from "./render-operating-board.js";

export function renderGovernedWorkBoard(report: GovernedWorkReportV1): string {
  return renderOperatingBoardHtml(projectOperatingBoard(report));
}

export { projectOperatingBoard } from "./project-operating-board.js";
export { renderOperatingBoardHtml } from "./render-operating-board.js";
export type {
  OperatingBoardNodeV1,
  OperatingBoardSummaryV1,
  OperatingBoardViewV1,
} from "./types.js";
