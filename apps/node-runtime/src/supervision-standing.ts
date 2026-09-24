import { randomUUID } from "node:crypto";

import type { InstalledOperatingMandate } from "@lervo/application-contract";
import { openRepositorySupervisionLeases, SupervisionMandateJournal } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  applyWorkstreamStartPlan,
  createWorkstreamStartPlan,
  readCurrentWorkstreamState,
} from "@lervo/repository-knowledge";
import {
  deriveSuccessorMandate,
  operatingContractHash,
  planMandateInstallation,
  successorId,
} from "@lervo/work-controller";

import {
  readInstalledNodeMandate,
  supervisionJournalCoordinates,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { observeMandateInstallationSource } from "./supervision-authority-source.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { SupervisionRequestRefusedError } from "./supervision-request-refusal.js";
import { readBoundWorkstreamState } from "./supervision-workstream-state.js";
import { resolveStandingRoot } from "./supervision-standing-root.js";
import {
  recordUnselectedStandingSuccessor,
  standingSuccessorMarker,
} from "./supervision-standing-bound-successor.js";

export interface StandingSupervisionResolution {
  /** The binding the runtime must use now: the latest successor, or the root itself. */
  binding: NodeSupervisionBinding;
  /** Lineage index of that binding; the root is 0. */
  index: number;
  installation: InstalledOperatingMandate;
}

const MAXIMUM_SUCCESSORS = 1024;

/**
 * Follows the root binding through the successor installations the owner recorded under its
 * reviewed grant. Each step is verified by the mandate journal, which checks the derivation
 * against the parent installation, so an unrelated installation cannot extend the lineage.
 */
export async function resolveStandingSupervisionBinding(
  storage: ProjectStorage,
  root: NodeSupervisionBinding,
  now: () => string,
): Promise<StandingSupervisionResolution> {
  const rootResolution = await resolveStandingRoot(storage, root, now);
  let current: StandingSupervisionResolution = {
    binding: rootResolution.binding,
    index: 0,
    installation: rootResolution.installation,
  };
  for (let index = 1; index <= MAXIMUM_SUCCESSORS; index += 1) {
    const supervisionId = successorId(root.supervisionId, index);
    let candidate: { workstreamId: string; mandateHash: string } | null = null;
    // The creating installation carries the derivation; later reviewed versions of the same
    // successor supervision are ordinary successions and must not break the lineage walk.
    let creationReviewHash: string | null = null;
    let afterSeq = 0;
    while (true) {
      const events = storage.events.list({ afterSeq, limit: 1000 });
      if (events.length === 0) break;
      for (const event of events) {
        afterSeq = event.seq;
        if (
          event.type === "work.supervision.mandate.installed" &&
          event.projectId === storage.manifest.projectId &&
          event.payload.supervisionId === supervisionId &&
          event.payload.ownerAgentId === root.ownerAgentId
        ) {
          creationReviewHash ??= String(event.payload.installationReviewHash);
          candidate = {
            workstreamId: String(event.payload.workstreamId),
            mandateHash: String(event.payload.mandateHash),
          };
        }
      }
      if (events.length < 1000) break;
    }
    if (candidate === null) break;
    const binding: NodeSupervisionBinding = {
      supervisionId,
      workstreamId: candidate.workstreamId,
      ownerAgentId: root.ownerAgentId,
      mandateHash: candidate.mandateHash,
    };
    const installation = await readInstalledNodeMandate(storage, binding, now);
    const derivation = (
      (await readSupervisionJsonArtifact(storage.artifacts, creationReviewHash!)) as {
        derivation?: unknown;
      }
    ).derivation as
      | { parentInstallationEventId: string; parentMandateHash: string; successorIndex: number }
      | undefined;
    const parentSupervisionId =
      index === 1 ? root.supervisionId : successorId(root.supervisionId, index - 1);
    const parent =
      derivation === undefined ? null : storage.events.get(derivation.parentInstallationEventId);
    if (
      derivation === undefined ||
      derivation.successorIndex !== index ||
      parent === null ||
      parent.type !== "work.supervision.mandate.installed" ||
      parent.projectId !== storage.manifest.projectId ||
      parent.payload.supervisionId !== parentSupervisionId ||
      parent.payload.ownerAgentId !== root.ownerAgentId
    )
      throw new Error("The standing supervision lineage is broken at a successor installation.");
    current = { binding, index, installation };
  }
  return current;
}

/**
 * Incrementally looks for a mandate installation under any watched supervision among events after
 * `afterSeq`, so a running service notices both a successor another process started and a reviewed
 * later version of the goal it is already running.
 */
export function scanForStandingLineageChange(
  storage: ProjectStorage,
  root: NodeSupervisionBinding,
  watched: readonly string[],
  afterSeq: number,
): { found: boolean; seq: number } {
  let seq = afterSeq;
  let found = false;
  while (true) {
    const events = storage.events.list({ afterSeq: seq, limit: 1000 });
    if (events.length === 0) break;
    for (const event of events) {
      seq = event.seq;
      if (
        event.type === "work.supervision.mandate.installed" &&
        event.projectId === storage.manifest.projectId &&
        watched.includes(String(event.payload.supervisionId)) &&
        event.payload.ownerAgentId === root.ownerAgentId
      )
        found = true;
    }
    if (events.length < 1000) break;
  }
  return { found, seq };
}

function successorTitle(request: string): string {
  const line = request.replace(/\s+/gu, " ").trim().slice(0, 96);
  return line.length > 0 ? line : "Supervised request";
}

/**
 * Starts the next goal of a standing lineage for one bound request: a successor workstream
 * whose objective is the request, then the derived successor mandate the reviewed grant permits.
 * Returns the binding the runtime must follow from now on.
 */
export async function startStandingSuccessor(input: {
  repositoryRoot: string;
  storage: ProjectStorage;
  current: StandingSupervisionResolution;
  request: { request: string; contentHash: string };
  provider: "codex" | "claude";
  now: () => string;
}): Promise<NodeSupervisionBinding> {
  const { storage, current } = input;
  const state = await readBoundWorkstreamState(storage, current.binding.workstreamId);
  if (
    state === null ||
    !["completed", "cancelled"].includes(state.snapshot.status) ||
    state.snapshot.blockers.length !== 0 ||
    (state.snapshot.pendingDecisions?.length ?? 0) !== 0 ||
    (state.snapshot.pendingApprovals?.length ?? 0) !== 0
  )
    throw new SupervisionRequestRefusedError(
      "workstream_inactive",
      "The standing lineage's current goal is not settled, so no successor goal can start.",
    );
  const parent = current.installation.mandate;
  if (parent.schemaVersion !== 3 || parent.successorAuthority === undefined)
    throw new SupervisionRequestRefusedError(
      "workstream_inactive",
      "The standing lineage has no remaining successor authority.",
    );
  const successorIndex = current.index + 1;
  const supervisionId = successorId(current.binding.supervisionId, successorIndex);
  const leases = await openRepositorySupervisionLeases(input.repositoryRoot);
  const lease = leases.acquire({
    supervisionId,
    ownerAgentId: parent.ownerAgentId,
    nowMs: Date.parse(input.now()),
    durationMs: 300_000,
  });
  if (lease === null) {
    leases.close();
    throw new Error("The successor supervision owner fence is held.");
  }
  try {
    const draft = {
      schemaVersion: 1,
      status: "active",
      title: successorTitle(input.request.request),
      objective: input.request.request.slice(0, 4000),
      nextActions: ["Answer the bound request with an independently accepted, verified result."],
      blockers: [],
      notes: [standingSuccessorMarker(successorIndex, input.request.contentHash)],
      references: [],
      updatedAt: input.now(),
    };
    const identity = randomUUID().replaceAll("-", "");
    let startEvent: { eventId: string; eventHash: string } | null = null;
    const selected = await readCurrentWorkstreamState(input.repositoryRoot);
    let receipt: { workstreamId: string };
    if (selected?.snapshot.workstreamId === current.binding.workstreamId) {
      const plan = await createWorkstreamStartPlan({
        repositoryRoot: input.repositoryRoot,
        projectId: storage.manifest.projectId,
        draft,
      });
      if (plan.status !== "ready" || plan.snapshot === null)
        throw new Error(
          `The successor goal could not be planned: ${plan.blockers.map((item) => item.code).join(", ")}.`,
        );
      receipt = await applyWorkstreamStartPlan({
        plan,
        now: new Date(input.now()),
        actor: "agent",
        recordApplied: async (applied, snapshotContent) => {
          const artifact = await storage.artifacts.put(snapshotContent);
          if (artifact.contentHash !== applied.snapshotContentHash)
            throw new Error("The successor goal snapshot differs from its start binding.");
          const appended = storage.events.append({
            eventId: `evt_${identity}`,
            projectId: applied.projectId,
            runId: `run_${identity}`,
            sessionId: `ses_${identity}`,
            type: "workstream.snapshot.recorded",
            occurredAt: applied.appliedAt,
            actor: { kind: "agent", provider: input.provider },
            schemaVersion: 1,
            policyVersion: applied.snapshotContentHash,
            payload: {
              workstreamId: applied.workstreamId,
              revision: applied.revision,
              status: applied.status,
              changeKind: applied.operation,
              snapshotArtifactId: `art_${applied.snapshotContentHash.slice("sha256:".length)}`,
              snapshotContentHash: applied.snapshotContentHash,
              previousSnapshotContentHash: applied.previousSnapshotContentHash,
              sourceArtifactId: null,
              sourceContentHash: null,
              recordedAt: applied.appliedAt,
            },
          });
          startEvent = { eventId: appended.event.eventId, eventHash: appended.event.eventHash };
        },
      });
    } else {
      const created = await recordUnselectedStandingSuccessor({
        storage,
        predecessor: state,
        draft,
        provider: input.provider,
        supervisionId,
        successorIndex,
        requestContentHash: input.request.contentHash,
        now: input.now,
      });
      startEvent = created.startEvent;
      receipt = { workstreamId: created.workstreamId };
    }
    if (startEvent === null) throw new Error("The successor goal start was not recorded.");
    const anchor: { eventId: string; eventHash: string } = startEvent;
    const mandate = deriveSuccessorMandate(parent, {
      successorIndex,
      workScope: {
        workstreamId: receipt.workstreamId,
        snapshotEventId: anchor.eventId,
        snapshotEventHash: anchor.eventHash,
      },
      issuedAt: input.now(),
    });
    const observeSource = () =>
      observeMandateInstallationSource(
        input.repositoryRoot,
        storage,
        mandate,
        "active",
        undefined,
        undefined,
        receipt.workstreamId,
      );
    const source = await observeSource();
    const installationPlan = planMandateInstallation({
      supervisionId,
      mandate,
      source,
      previous: null,
      reviewerId: mandate.appointingAuthorityId,
      now: input.now(),
      derivation: {
        schemaVersion: 1,
        parentInstallationEventId: current.installation.eventId,
        parentMandateHash: current.installation.mandateHash,
        successorIndex,
      },
    });
    const binding: NodeSupervisionBinding = {
      supervisionId,
      workstreamId: receipt.workstreamId,
      ownerAgentId: mandate.ownerAgentId,
      mandateHash: installationPlan.mandateHash,
    };
    const revalidate = async () => {
      const fresh = await observeSource();
      if (operatingContractHash(fresh) !== operatingContractHash(source))
        throw new Error("The successor goal source changed before its mandate was installed.");
    };
    await new SupervisionMandateJournal(
      storage.events,
      storage.artifacts,
      supervisionJournalCoordinates(storage, binding, source.workstreamRevision),
      input.now,
      { store: leases, lease },
    ).install(installationPlan, installationPlan.approvalHash, revalidate);
    return binding;
  } finally {
    leases.release(lease);
    leases.close();
  }
}
