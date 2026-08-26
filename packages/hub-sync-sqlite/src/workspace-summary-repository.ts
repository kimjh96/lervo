import { type DatabaseSync } from "node:sqlite";

import {
  HUB_WORKSPACE_COORDINATION_POLICY_V1,
  isHubWorkspaceSummary,
  type HubWorkspaceSummary,
} from "@lervo/hub-sync";

import {
  HubWorkspaceCoordinationPolicySQLiteRepository,
  workspaceCoordinationFail,
  workspaceCoordinationNumber,
  workspaceCoordinationString,
  workspaceCoordinationTime,
  workspaceSummaryTransitions,
} from "./workspace-coordination-common.js";

export class HubWorkspaceSummarySQLiteRepository {
  private readonly policy: HubWorkspaceCoordinationPolicySQLiteRepository;

  constructor(private readonly database: DatabaseSync) {
    this.policy = new HubWorkspaceCoordinationPolicySQLiteRepository(database);
  }

  private prune(input: {
    destinationId: string;
    projectId: string;
    repositoryIdentityHash: string;
    acceptedAt: string;
  }): void {
    this.database
      .prepare(
        `DELETE FROM hub_workspace_summaries
        WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
          AND retained_until_ms <= ?`,
      )
      .run(
        input.destinationId,
        input.projectId,
        input.repositoryIdentityHash,
        workspaceCoordinationTime(input.acceptedAt, "workspace summary acceptedAt"),
      );
  }

  publish(input: { destinationId: string; summary: HubWorkspaceSummary; acceptedAt: string }): {
    status: "created" | "updated" | "duplicate";
    summary: HubWorkspaceSummary;
  } {
    if (!isHubWorkspaceSummary(input.summary))
      workspaceCoordinationFail(
        "workspace_coordination_invalid",
        "The workspace summary is invalid.",
      );
    this.policy.ensure({
      ...input.summary,
      destinationId: input.destinationId,
      acceptedAt: input.acceptedAt,
    });
    this.prune({
      ...input.summary,
      destinationId: input.destinationId,
      acceptedAt: input.acceptedAt,
    });
    const row = this.database
      .prepare(
        `SELECT * FROM hub_workspace_summaries
        WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
          AND workspace_id = ?`,
      )
      .get(
        input.destinationId,
        input.summary.projectId,
        input.summary.repositoryIdentityHash,
        input.summary.workspaceId,
      ) as Record<string, unknown> | undefined;
    if (row !== undefined && row.summary_content_hash === input.summary.contentHash)
      return { status: "duplicate", summary: input.summary };
    const previous =
      row === undefined
        ? null
        : (JSON.parse(workspaceCoordinationString(row, "summary_json")) as HubWorkspaceSummary);
    if (previous !== null) {
      if (
        input.summary.generation < previous.generation ||
        (input.summary.generation > previous.generation &&
          input.summary.state !== "provisioning") ||
        (input.summary.generation === previous.generation &&
          input.summary.state !== previous.state &&
          !workspaceSummaryTransitions[previous.state].includes(input.summary.state)) ||
        Date.parse(input.summary.updatedAt) <= Date.parse(previous.updatedAt)
      )
        workspaceCoordinationFail(
          "workspace_coordination_stale_generation",
          "The workspace summary generation or lifecycle transition is stale.",
        );
    } else {
      if (input.summary.state !== "provisioning")
        workspaceCoordinationFail(
          "workspace_coordination_stale_generation",
          "The first workspace summary must establish the provisioning parent state.",
        );
      const count = this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM hub_workspace_summaries
          WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?`,
        )
        .get(
          input.destinationId,
          input.summary.projectId,
          input.summary.repositoryIdentityHash,
        ) as Record<string, unknown>;
      if (
        workspaceCoordinationNumber(count, "count") >=
        HUB_WORKSPACE_COORDINATION_POLICY_V1.maxRetainedTerminalSummaries
      )
        workspaceCoordinationFail(
          "workspace_coordination_capacity",
          "The retained workspace summary capacity is full.",
        );
    }
    const retention =
      workspaceCoordinationTime(input.acceptedAt, "workspace summary acceptedAt") +
      HUB_WORKSPACE_COORDINATION_POLICY_V1.terminalSummaryRetentionMs;
    this.database
      .prepare(
        `INSERT INTO hub_workspace_summaries (
          destination_id, project_id, repository_identity_hash, workspace_id,
          assignment_id, node_id, generation, state, summary_content_hash,
          summary_json, updated_at, updated_at_ms, retained_until_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (destination_id, project_id, repository_identity_hash, workspace_id)
        DO UPDATE SET assignment_id = excluded.assignment_id, node_id = excluded.node_id,
          generation = excluded.generation, state = excluded.state,
          summary_content_hash = excluded.summary_content_hash,
          summary_json = excluded.summary_json, updated_at = excluded.updated_at,
          updated_at_ms = excluded.updated_at_ms, retained_until_ms = excluded.retained_until_ms`,
      )
      .run(
        input.destinationId,
        input.summary.projectId,
        input.summary.repositoryIdentityHash,
        input.summary.workspaceId,
        input.summary.assignmentId,
        input.summary.nodeId,
        input.summary.generation,
        input.summary.state,
        input.summary.contentHash,
        JSON.stringify(input.summary),
        input.summary.updatedAt,
        workspaceCoordinationTime(input.summary.updatedAt, "workspace summary updatedAt"),
        retention,
      );
    this.audit(input, previous);
    return { status: previous === null ? "created" : "updated", summary: input.summary };
  }

  private audit(
    input: { destinationId: string; summary: HubWorkspaceSummary; acceptedAt: string },
    previous: HubWorkspaceSummary | null,
  ): void {
    const event = {
      schemaVersion: 1,
      type: "workspace.summary.recorded",
      projectId: input.summary.projectId,
      repositoryIdentityHash: input.summary.repositoryIdentityHash,
      workspaceId: input.summary.workspaceId,
      assignmentId: input.summary.assignmentId,
      nodeId: input.summary.nodeId,
      generation: input.summary.generation,
      previousState: previous?.state ?? null,
      state: input.summary.state,
      processObservation: input.summary.processObservation,
      terminalCount: input.summary.terminalCount,
      integrationEvidenceId: input.summary.integrationEvidenceId,
      cleanupPlanId: input.summary.cleanupPlanId,
      contentHash: input.summary.contentHash,
      occurredAt: input.acceptedAt,
    };
    this.database
      .prepare(
        `INSERT INTO hub_workspace_summary_audit (
          destination_id, project_id, repository_identity_hash, workspace_id,
          generation, previous_state, state, summary_content_hash, occurred_at, event_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.destinationId,
        input.summary.projectId,
        input.summary.repositoryIdentityHash,
        input.summary.workspaceId,
        input.summary.generation,
        previous?.state ?? null,
        input.summary.state,
        input.summary.contentHash,
        input.acceptedAt,
        JSON.stringify(event),
      );
  }

  list(input: {
    destinationId: string;
    projectId: string;
    repositoryIdentityHash: string;
    acceptedAt: string;
  }): HubWorkspaceSummary[] {
    this.policy.ensure(input);
    this.prune(input);
    const rows = this.database
      .prepare(
        `SELECT summary_json FROM hub_workspace_summaries
        WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
        ORDER BY workspace_id`,
      )
      .all(input.destinationId, input.projectId, input.repositoryIdentityHash) as Record<
      string,
      unknown
    >[];
    return rows.map((row) => {
      const summary = JSON.parse(
        workspaceCoordinationString(row, "summary_json"),
      ) as HubWorkspaceSummary;
      if (!isHubWorkspaceSummary(summary))
        workspaceCoordinationFail(
          "workspace_coordination_invalid",
          "A stored workspace summary is invalid.",
        );
      return summary;
    });
  }
}
