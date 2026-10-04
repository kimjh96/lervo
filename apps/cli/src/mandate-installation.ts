import type { MandateInstallationPlan, OperatingMandate } from "@lervo/application-contract";
import {
  listAssignments,
  openRepositorySupervisionLeases,
  SupervisionMandateJournal,
} from "@lervo/agent-workforce";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { loadProjectManifest } from "@lervo/project";
import { observeMandateExecutionAuthority } from "@lervo/node-runtime";
import {
  assertMandateInstallationPlan,
  assertOperatingMandate,
  operatingContractHash,
  planMandateInstallation,
  selectOperatingWorkScope,
} from "@lervo/work-controller";
import { observeMandateInstallationSource } from "./mandate-installation-source.js";

function journal(
  storage: ProjectStorage,
  supervisionId: string,
  workstreamId: string,
  workstreamRevision: number,
  ownerAgentId: string,
  fence: ConstructorParameters<typeof SupervisionMandateJournal>[4] = null,
) {
  return new SupervisionMandateJournal(
    storage.events,
    storage.artifacts,
    {
      projectId: storage.manifest.projectId,
      supervisionId,
      workstreamId,
      workstreamRevision,
      ownerAgentId,
      mandateHash: operatingContractHash({ supervisionId }),
      sessionId: `ses_${operatingContractHash({ supervisionId }).slice(7, 39)}`,
      policyVersion: operatingContractHash({ contract: "operating_mandate.installation.v1" }),
    },
    () => new Date().toISOString(),
    fence,
  );
}

function observeReviewedMandateSource(
  root: string,
  storage: ProjectStorage,
  mandate: OperatingMandate,
) {
  return observeMandateInstallationSource(
    root,
    storage,
    mandate,
    "active",
    undefined,
    undefined,
    mandate.schemaVersion === 3 ? mandate.workScope.workstreamId : undefined,
  );
}

export async function selectRepositoryMandateWorkScope(input: {
  root: string;
  workstreamId?: string;
}) {
  const storage = await openProjectStorage(input.root);
  try {
    const current = await readCurrentWorkstreamState(input.root);
    const workstreamId = input.workstreamId ?? current?.snapshot.workstreamId;
    if (workstreamId === undefined)
      throw new Error("Work-scope selection requires a workstream coordinate.");
    const events: ReturnType<ProjectStorage["events"]["list"]> = [];
    let afterSeq = 0;
    while (true) {
      const page = storage.events.list({ afterSeq, limit: 1_000 });
      if (page.length === 0) break;
      events.push(...page);
      afterSeq = page.at(-1)!.seq;
      if (events.length > 32_768)
        throw new Error("Work-scope selection exceeds the complete event-source bound.");
    }
    return selectOperatingWorkScope({
      projectId: storage.manifest.projectId,
      workstreamId,
      events,
      assignments: await listAssignments(input.root),
    });
  } finally {
    await storage.close();
  }
}

export async function createRepositoryMandatePlan(input: {
  root: string;
  supervisionId: string;
  mandate: OperatingMandate;
  reviewerId: string;
}) {
  input = structuredClone(input);
  assertOperatingMandate(input.mandate);
  const storage = await openProjectStorage(input.root);
  try {
    const source = await observeReviewedMandateSource(input.root, storage, input.mandate);
    const previous = await journal(
      storage,
      input.supervisionId,
      source.workstreamId,
      source.workstreamRevision,
      source.ownerAgentId,
    ).current();
    return planMandateInstallation({ ...input, source, previous, now: new Date().toISOString() });
  } finally {
    await storage.close();
  }
}

export async function installRepositoryMandate(input: {
  root: string;
  plan: MandateInstallationPlan;
  approval: string;
  reviewerId: string;
}) {
  input = structuredClone(input);
  const { plan } = input;
  assertMandateInstallationPlan(plan);
  if (
    input.reviewerId !== plan.mandate.appointingAuthorityId ||
    input.approval !== plan.approvalHash
  )
    throw new Error(
      "Mandate installation requires the exact plan approval and appointing reviewer.",
    );
  const storage = await openProjectStorage(input.root);
  try {
    const leases = await openRepositorySupervisionLeases(input.root);
    try {
      const lease = leases.acquire({
        supervisionId: plan.supervisionId,
        ownerAgentId: plan.mandate.ownerAgentId,
        nowMs: Date.now(),
        durationMs: 300_000,
      });
      if (lease === null)
        throw new Error("The supervision owner requires reconciliation before installation.");
      try {
        const revalidate = async () => {
          const startedAt = Date.now();
          const source = await observeReviewedMandateSource(input.root, storage, plan.mandate);
          if (
            operatingContractHash(source) !== operatingContractHash(plan.source) ||
            Date.now() - startedAt > 5000
          )
            throw new Error(
              "The reviewed mandate installation source changed or could not be observed freshly.",
            );
        };
        await revalidate();
        return await journal(
          storage,
          plan.supervisionId,
          plan.source.workstreamId,
          plan.source.workstreamRevision,
          plan.mandate.ownerAgentId,
          { store: leases, lease },
        ).install(plan, input.approval, revalidate);
      } finally {
        leases.release(lease);
      }
    } finally {
      leases.close();
    }
  } finally {
    await storage.close();
  }
}

export async function inspectRepositoryMandate(input: {
  root: string;
  supervisionId: string;
  workstreamId?: string;
}) {
  const storage = await openProjectStorage(input.root);
  try {
    const current = await readCurrentWorkstreamState(input.root);
    const workstreamId = input.workstreamId ?? current?.snapshot.workstreamId;
    if (workstreamId === undefined)
      throw new Error("Mandate inspection requires a workstream coordinate.");
    return await journal(
      storage,
      input.supervisionId,
      workstreamId,
      current?.snapshot.revision ?? 1,
      `agt_${"0".repeat(24)}`,
    ).current();
  } finally {
    await storage.close();
  }
}

export async function revokeRepositoryMandate(input: {
  root: string;
  supervisionId: string;
  workstreamId: string;
  mandateHash: string;
  installationEventId: string;
  reviewerId: string;
}) {
  const storage = await openProjectStorage(input.root);
  try {
    if ((storage.writableEventSchemaVersion ?? 1) < 3)
      throw new Error("Mandate revocation requires event writer version 3.");
    const inspected = await journal(
      storage,
      input.supervisionId,
      input.workstreamId,
      1,
      `agt_${"0".repeat(24)}`,
    ).current();
    if (inspected === null) throw new Error("There is no installed mandate to revoke.");
    const leases = await openRepositorySupervisionLeases(input.root);
    try {
      const lease = leases.acquire({
        supervisionId: input.supervisionId,
        ownerAgentId: inspected.mandate.ownerAgentId,
        nowMs: Date.now(),
        durationMs: 300_000,
      });
      if (lease === null)
        throw new Error("The supervision owner requires reconciliation before revocation.");
      try {
        const manifest = await loadProjectManifest(input.root);
        if (manifest.projectId !== storage.manifest.projectId)
          throw new Error("The mandate repository identity changed.");
        await observeMandateExecutionAuthority({
          mandate: inspected.mandate,
          hubSyncEnabled: manifest.dataPolicy.hubSyncEnabled,
        });
        return await journal(
          storage,
          input.supervisionId,
          input.workstreamId,
          Number(storage.events.get(inspected.eventId)!.payload.workstreamRevision),
          inspected.mandate.ownerAgentId,
          { store: leases, lease },
        ).revoke(input);
      } finally {
        leases.release(lease);
      }
    } finally {
      leases.close();
    }
  } finally {
    await storage.close();
  }
}

/** Without an approval returns the exact review; with it records the fenced resolution. */
export async function resolveRepositoryPreflight(input: {
  root: string;
  supervisionId: string;
  workstreamId: string;
  blockedEventId: string;
  reviewerId: string;
  approval?: string;
}) {
  const storage = await openProjectStorage(input.root);
  try {
    if ((storage.writableEventSchemaVersion ?? 1) < 3)
      throw new Error("Preflight resolution requires event writer version 3.");
    const inspected = await journal(
      storage,
      input.supervisionId,
      input.workstreamId,
      1,
      `agt_${"0".repeat(24)}`,
    ).current();
    if (inspected === null || inspected.revoked)
      throw new Error("Preflight resolution requires a current installed mandate.");
    const bound = (fence: Parameters<typeof journal>[5]) =>
      journal(
        storage,
        input.supervisionId,
        input.workstreamId,
        Number(storage.events.get(inspected.eventId)!.payload.workstreamRevision),
        inspected.mandate.ownerAgentId,
        fence,
      );
    const review = await bound(null).reviewPreflightResolution(
      input.blockedEventId,
      input.reviewerId,
    );
    if (input.approval === undefined)
      return { review, approvalHash: operatingContractHash(review) };
    const leases = await openRepositorySupervisionLeases(input.root);
    try {
      const lease = leases.acquire({
        supervisionId: input.supervisionId,
        ownerAgentId: inspected.mandate.ownerAgentId,
        nowMs: Date.now(),
        durationMs: 300_000,
      });
      if (lease === null)
        throw new Error("The supervision owner requires reconciliation before resolution.");
      try {
        const eventId = await bound({ store: leases, lease }).resolvePreflight(
          input.blockedEventId,
          input.reviewerId,
          input.approval,
        );
        return { eventId, review };
      } finally {
        leases.release(lease);
      }
    } finally {
      leases.close();
    }
  } finally {
    await storage.close();
  }
}
