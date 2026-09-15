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
  let current: StandingSupervisionResolution = {
    binding: structuredClone(root),
    index: 0,
    installation: await readInstalledNodeMandate(storage, root, now),
  };
  for (let index = 1; index <= MAXIMUM_SUCCESSORS; index += 1) {
    const supervisionId = successorId(root.supervisionId, index);
    let candidate: { workstreamId: string; mandateHash: string } | null = null;
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
        )
          candidate = {
            workstreamId: String(event.payload.workstreamId),
            mandateHash: String(event.payload.mandateHash),
          };
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
      (await readSupervisionJsonArtifact(
        storage.artifacts,
        installation.installationReviewHash,
      )) as { derivation?: unknown }
    ).derivation as
      | { parentInstallationEventId: string; parentMandateHash: string; successorIndex: number }
      | undefined;
    if (
      derivation === undefined ||
      derivation.parentInstallationEventId !== current.installation.eventId ||
      derivation.parentMandateHash !== current.installation.mandateHash ||
      derivation.successorIndex !== index
    )
      throw new Error("The standing supervision lineage is broken at a successor installation.");
    current = { binding, index, installation };
  }
  return current;
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
  const state = await readCurrentWorkstreamState(input.repositoryRoot);
  if (
    state === null ||
    state.snapshot.workstreamId !== current.binding.workstreamId ||
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
  const draft = {
    schemaVersion: 1,
    status: "active",
    title: successorTitle(input.request.request),
    objective: input.request.request.slice(0, 4000),
    nextActions: ["Answer the bound request with an independently accepted, verified result."],
    blockers: [],
    notes: [
      `Successor goal ${successorIndex} of the standing lineage, started by the installed owner for request ${input.request.contentHash}.`,
    ],
    references: [],
    updatedAt: input.now(),
  };
  const plan = await createWorkstreamStartPlan({
    repositoryRoot: input.repositoryRoot,
    projectId: storage.manifest.projectId,
    draft,
  });
  if (plan.status !== "ready" || plan.snapshot === null)
    throw new Error(
      `The successor goal could not be planned: ${plan.blockers.map((item) => item.code).join(", ")}.`,
    );
  const identity = randomUUID().replaceAll("-", "");
  let startEvent: { eventId: string; eventHash: string } | null = null;
  const receipt = await applyWorkstreamStartPlan({
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
  const supervisionId = successorId(current.binding.supervisionId, successorIndex);
  const observeSource = () =>
    observeMandateInstallationSource(input.repositoryRoot, storage, mandate, "active");
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
  const leases = await openRepositorySupervisionLeases(input.repositoryRoot);
  try {
    const lease = leases.acquire({
      supervisionId,
      ownerAgentId: mandate.ownerAgentId,
      nowMs: Date.parse(input.now()),
      durationMs: 300_000,
    });
    if (lease === null) throw new Error("The successor supervision owner fence is held.");
    try {
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
    } finally {
      leases.release(lease);
    }
  } finally {
    leases.close();
  }
  return binding;
}
