import type { WorkGraphV1 } from "./types.js";

export interface OperatingGoalReportV1 {
  schemaVersion: 1;
  kind: "operating_goal.report";
  projectId: string;
  observedAt: string;
  goal: {
    goalId: string;
    authoritySource: "workstream";
    revision: number;
    status: "active" | "blocked" | "completed" | "cancelled";
    title: string;
    objective: string;
    updatedAt: string;
  };
  hierarchy: {
    kind: "workstream_assignment_dag";
    graph: WorkGraphV1;
  };
  progress: {
    total: number;
    queued: number;
    active: number;
    blocked: number;
    failed: number;
    completed: number;
    cancelled: number;
  };
  completion: {
    status: "active" | "blocked" | "ready_for_completion" | "completed" | "inconsistent";
    reasonCodes: string[];
  };
  authority: {
    createsGoal: false;
    changesWorkstream: false;
    changesAssignments: false;
    startsProvider: false;
  };
  limitations: string[];
}
