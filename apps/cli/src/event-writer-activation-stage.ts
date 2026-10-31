import {
  applyEventWriterActivationPlan,
  eventWriterActivationObservationHash,
  inspectEventWriterCoordinate,
  planEventWriterActivation,
  type EventWriterActivationPlan,
  type EventWriterActivationReceipt,
} from "@lervo/project";
import { TERMINAL_SKILL_EVENT_SCHEMA_VERSION } from "@lervo/repository-knowledge-runtime";
import type { EventWriterActivationEvidence } from "@lervo/schemas";

import {
  createEventWriterActivationBackup,
  type EventWriterActivationBackup,
} from "./event-writer-activation-backup.js";
import { eventWriterBlocker } from "./event-writer-activation-blockers.js";
import { collectEventReaderActivationEvidence } from "./event-reader-inventory.js";
import { planTerminalIntegrationStage } from "./terminal-integration-stage.js";
import type { UpgradeStageBlocker } from "./upgrade-stage-inspection.js";
import type { StageDisposition } from "./upgrade-stage-policy.js";

/** The writer version repository upgrades converge on: the one background knowledge needs. */
export const TARGET_EVENT_SCHEMA_VERSION = TERMINAL_SKILL_EVENT_SCHEMA_VERSION;

export type EventReaderAuthority = "local" | "repository_node_absent" | "repository_node_fleet";

export interface EventWriterStage {
  disposition: StageDisposition;
  reason: string;
  currentSchemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  targetSchemaVersion: typeof TARGET_EVENT_SCHEMA_VERSION;
  /** Which reader inventory authority the evidence came from; null before evidence exists. */
  authority: EventReaderAuthority | null;
  /** Hash of the reader observation without its timestamp; binds the outer upgrade plan. */
  observationHash: string | null;
  currentCoordinateHash: string | null;
  blockers: UpgradeStageBlocker[];
}

export interface EventWriterStagePorts {
  collectEvidence(input: { repositoryRoot: string }): Promise<EventWriterActivationEvidence>;
  /** Whether the repository's generated terminal hook runtime reads the target schema. */
  hookReader(repositoryRoot: string): Promise<"current" | "stale">;
  now(): Date;
}

async function generatedHookReader(repositoryRoot: string): Promise<"current" | "stale"> {
  const { plan } = await planTerminalIntegrationStage(repositoryRoot);
  // An absent runtime is no reader; an unchanged one is this CLI's own reader bundle.
  return plan.runtime.action === "unchanged" || plan.runtime.action === "create"
    ? "current"
    : "stale";
}

export const defaultEventWriterStagePorts: EventWriterStagePorts = {
  collectEvidence: collectEventReaderActivationEvidence,
  hookReader: generatedHookReader,
  now: () => new Date(),
};

function authorityOf(evidence: EventWriterActivationEvidence): EventReaderAuthority {
  if (evidence.schemaVersion !== 2) return "local";
  return evidence.authority.kind === "repository_node_absent_v1"
    ? "repository_node_absent"
    : "repository_node_fleet";
}

interface ObservedEventWriterStage {
  stage: EventWriterStage;
  plan: EventWriterActivationPlan | null;
}

function blocked(
  base: Pick<EventWriterStage, "currentSchemaVersion" | "currentCoordinateHash">,
  blockers: UpgradeStageBlocker[],
  authority: EventReaderAuthority | null = null,
): ObservedEventWriterStage {
  return {
    stage: {
      disposition: "blocked",
      reason: "event_writer_activation_blocked",
      ...base,
      targetSchemaVersion: TARGET_EVENT_SCHEMA_VERSION,
      authority,
      observationHash: null,
      blockers,
    },
    plan: null,
  };
}

async function observeEventWriterStage(
  repositoryRoot: string,
  ports: EventWriterStagePorts,
): Promise<ObservedEventWriterStage> {
  let current: Awaited<ReturnType<typeof inspectEventWriterCoordinate>>;
  try {
    current = await inspectEventWriterCoordinate(repositoryRoot);
  } catch (error) {
    return blocked({ currentSchemaVersion: 1, currentCoordinateHash: null }, [
      eventWriterBlocker(error),
    ]);
  }
  const base = {
    currentSchemaVersion: current.coordinate.selectedEventSchemaVersion,
    currentCoordinateHash: current.contentHash,
  };
  if (base.currentSchemaVersion >= TARGET_EVENT_SCHEMA_VERSION)
    return {
      stage: {
        disposition: "current",
        reason: "event_writer_current",
        ...base,
        targetSchemaVersion: TARGET_EVENT_SCHEMA_VERSION,
        authority: null,
        observationHash: null,
        blockers: [],
      },
      plan: null,
    };
  if ((await ports.hookReader(repositoryRoot)) === "stale")
    return blocked(base, [eventWriterBlocker({ code: "terminal_hook_reader_stale" })]);
  let evidence: EventWriterActivationEvidence;
  try {
    evidence = await ports.collectEvidence({ repositoryRoot });
  } catch (error) {
    return blocked(base, [eventWriterBlocker(error)]);
  }
  const authority = authorityOf(evidence);
  let plan: EventWriterActivationPlan;
  try {
    plan = await planEventWriterActivation({
      repositoryRoot,
      evidence,
      targetEventSchemaVersion: TARGET_EVENT_SCHEMA_VERSION,
    });
  } catch (error) {
    return blocked(base, [eventWriterBlocker(error)], authority);
  }
  if (plan.status === "blocked")
    return blocked(
      base,
      plan.blockers.map((item) => eventWriterBlocker(item)),
      authority,
    );
  return {
    stage: {
      disposition: plan.status === "ready" ? "safe_apply" : "current",
      reason: plan.status === "ready" ? "event_writer_activation_ready" : "event_writer_current",
      ...base,
      targetSchemaVersion: TARGET_EVENT_SCHEMA_VERSION,
      authority,
      observationHash: eventWriterActivationObservationHash(evidence),
      blockers: [],
    },
    plan: plan.status === "ready" ? plan : null,
  };
}

/** Read-only: the event writer activation the upgrade (or a resident) would apply. */
export async function inspectEventWriterStage(
  repositoryRoot: string,
  ports: EventWriterStagePorts = defaultEventWriterStagePorts,
): Promise<EventWriterStage> {
  return (await observeEventWriterStage(repositoryRoot, ports)).stage;
}

export type EventWriterStageOutcome =
  | {
      status: "activated";
      receipt: EventWriterActivationReceipt;
      backup: EventWriterActivationBackup;
    }
  | { status: "current" }
  | { status: "skipped"; stage: EventWriterStage };

/**
 * Applies the existing event-contract plan for the target version: backup first, then the exact
 * current plan ID with freshly re-observed reader evidence, as `lervo event-contract activate
 * --apply` does. An approved `safe_apply` stage must still match its reader observation and
 * coordinate; a deferred stage applies only if it has become ready, and is otherwise skipped.
 */
export async function applyEventWriterStage(
  repositoryRoot: string,
  approved: EventWriterStage,
  ports: EventWriterStagePorts = defaultEventWriterStagePorts,
): Promise<EventWriterStageOutcome> {
  const observed = await observeEventWriterStage(repositoryRoot, ports);
  if (observed.stage.disposition === "current") return { status: "current" };
  if (
    approved.disposition === "safe_apply" &&
    (observed.stage.disposition !== "safe_apply" ||
      observed.stage.observationHash !== approved.observationHash ||
      observed.stage.currentCoordinateHash !== approved.currentCoordinateHash)
  )
    throw Object.assign(
      new Error("The event writer activation inputs changed after the upgrade was planned."),
      { code: "event_writer_plan_stale" },
    );
  if (observed.plan === null) return { status: "skipped", stage: observed.stage };
  const backup = await createEventWriterActivationBackup({
    repositoryRoot,
    targetEventSchemaVersion: TARGET_EVENT_SCHEMA_VERSION,
    planId: observed.plan.planId,
    now: ports.now(),
  });
  const receipt = await applyEventWriterActivationPlan({
    plan: observed.plan,
    approval: observed.plan.planId,
    currentEvidence: await ports.collectEvidence({ repositoryRoot }),
  });
  return { status: "activated", receipt, backup };
}

export type LocalEventWriterActivation =
  | { status: "current" }
  | { status: "activated"; backup: EventWriterActivationBackup }
  | { status: "held"; code: string };

/**
 * ADR-0470 automatic local-only activation for residents and onboarding. It applies only when the
 * reader inventory is this host's local runtime alone (a local-only checkout, or a Hub-enabled
 * one with no registered Node); distributed activation stays with `lervo upgrade`, which
 * re-observes the Node and Hub. Blockers are never bypassed: a held result names the first one.
 */
export async function activateLocalEventWriter(
  repositoryRoot: string,
  ports: EventWriterStagePorts = defaultEventWriterStagePorts,
): Promise<LocalEventWriterActivation> {
  const stage = await inspectEventWriterStage(repositoryRoot, ports);
  if (stage.disposition === "current") return { status: "current" };
  if (stage.disposition !== "safe_apply")
    return { status: "held", code: stage.blockers[0]?.code ?? stage.reason };
  if (stage.authority === "repository_node_fleet")
    return { status: "held", code: "event_writer_distributed_activation_required" };
  try {
    const outcome = await applyEventWriterStage(repositoryRoot, stage, ports);
    if (outcome.status === "activated") return { status: "activated", backup: outcome.backup };
    if (outcome.status === "current") return { status: "current" };
    return { status: "held", code: outcome.stage.blockers[0]?.code ?? outcome.stage.reason };
  } catch (error) {
    return { status: "held", code: eventWriterBlocker(error).code };
  }
}
