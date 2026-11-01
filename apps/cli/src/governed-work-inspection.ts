import {
  normalizeGovernedLoopPolicy,
  type ApprovalAuthorityPort,
  type GovernedLoopPolicyV1,
  type GovernedWorkQueryV1,
  type GovernedWorkReportV1,
} from "@lervo/application-contract";
import { listAssignments } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { collectEventsOfTypesBounded } from "@lervo/storage-contract";
import { governedWorkReportEventTypes, projectGovernedWorkReport } from "@lervo/work-controller";

import { verifiedCurrentWorkstream } from "./workstream-services.js";
import { observeGraphApprovals } from "./approval-authority-observer.js";

/** Bounds the governed-work events retained, never the length of project history. */
const maximumSourceEvents = 100_000;

export interface InspectGovernedWorkInput {
  repositoryRoot: string;
  policy?: Partial<GovernedLoopPolicyV1>;
  observedAt?: Date;
}

export type InspectGovernedWork = (
  input: InspectGovernedWorkInput,
) => Promise<GovernedWorkReportV1>;

export function createGovernedWorkInspector(
  options: {
    approvalAuthority?: ApprovalAuthorityPort;
  } = {},
): InspectGovernedWork {
  return async (input) => {
    const storage = await openProjectStorage(input.repositoryRoot);
    try {
      const workstream = await verifiedCurrentWorkstream(storage);
      if (workstream === null || workstream.status !== "active") {
        throw new Error("Governed work requires one verified active workstream.");
      }
      const [assignments, events] = await Promise.all([
        listAssignments(storage.paths.repositoryRoot),
        Promise.resolve(
          collectEventsOfTypesBounded({
            events: storage.events,
            types: governedWorkReportEventTypes,
            maximumEvents: maximumSourceEvents,
          }),
        ),
      ]);
      const query: GovernedWorkQueryV1 = {
        schemaVersion: 1,
        kind: "governed_work.inspect",
        projectId: storage.manifest.projectId,
        workstreamId: workstream.workstreamId,
        observedAt: (input.observedAt ?? new Date()).toISOString(),
        policy: normalizeGovernedLoopPolicy(input.policy),
      };
      const initial = projectGovernedWorkReport({ query, assignments, events });
      if (options.approvalAuthority === undefined) return initial;
      const approvals = await observeGraphApprovals({
        authority: options.approvalAuthority,
        graph: initial.graph,
      });
      return projectGovernedWorkReport({ query, assignments, events, approvals });
    } finally {
      await storage.close();
    }
  };
}

export const inspectGovernedWork = createGovernedWorkInspector();
