import {
  SupervisionResponsibilityClaimer,
  SupervisionResponsibilityReader,
  renewSupervisedWorkerLease,
  type SQLiteSupervisionOwnerLeaseStore,
  type SupervisionOwnerLease,
  type SupervisionResponsibilityClaim,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  NodeSupervisionError,
  observeNodeSupervisionAuthority,
  supervisionJournalCoordinates,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";

type Authority = Awaited<ReturnType<typeof observeNodeSupervisionAuthority>>;

/** Responsibility claim, worker lease renewal, and binding reads bound to one owner session. */
export function createSessionResponsibilityOperations(context: {
  storage: ProjectStorage;
  leases: SQLiteSupervisionOwnerLeaseStore;
  binding: NodeSupervisionBinding;
  now: () => string;
  assertOpen(): void;
  currentLease(): SupervisionOwnerLease;
  readAuthority(): Promise<Authority>;
}) {
  const coordinates = (authority: Authority) =>
    supervisionJournalCoordinates(
      context.storage,
      context.binding,
      authority.source.workstreamRevision,
    );
  return {
    claimResponsibility: async (
      claim: SupervisionResponsibilityClaim,
      authorityDigest: string,
      revalidate: (assignment: WorkforceAssignment) => Promise<void>,
    ) => {
      context.assertOpen();
      claim = structuredClone(claim);
      const authority = await context.readAuthority();
      context.assertOpen();
      if (
        authority.source.sourceRevisionDigest !== authorityDigest ||
        claim.maximumDeadlineMs !== authority.installation.mandate.maximumDeadlineMs ||
        Date.parse(claim.responsibility.completionDeadline) >
          Date.parse(authority.installation.mandate.expiresAt) ||
        claim.responsibility.reviewerAgentId !== context.binding.ownerAgentId ||
        !authority.source.causationEventIds.every((id) => claim.causationEventIds.includes(id))
      )
        throw new NodeSupervisionError("supervision_authority_changed");
      const claimer = new SupervisionResponsibilityClaimer(
        context.storage.paths.repositoryRoot,
        context.storage.events,
        context.storage.artifacts,
        coordinates(authority),
        context.now,
        { store: context.leases, lease: context.currentLease() },
      );
      return claimer.claim(claim, async (assignment) => {
        context.assertOpen();
        await revalidate(assignment);
        const current = await context.readAuthority();
        context.assertOpen();
        if (current.source.sourceRevisionDigest !== authorityDigest)
          throw new NodeSupervisionError("supervision_authority_changed");
      });
    },
    renewWorkerLease: async (input: {
      assignmentId: string;
      agentId: string;
      leaseId: string;
      leaseDurationMs: number;
    }) => {
      context.assertOpen();
      const authority = await context.readAuthority();
      context.assertOpen();
      return renewSupervisedWorkerLease({
        repositoryRoot: context.storage.paths.repositoryRoot,
        events: context.storage.events,
        artifacts: context.storage.artifacts,
        coordinates: coordinates(authority),
        now: context.now,
        fence: { store: context.leases, lease: context.currentLease() },
        ...input,
      });
    },
    readResponsibility: async (assignmentId: string) => {
      context.assertOpen();
      const authority = await context.readAuthority();
      context.assertOpen();
      return new SupervisionResponsibilityReader(
        context.storage.events,
        context.storage.artifacts,
        coordinates(authority),
        context.now,
      ).current(assignmentId);
    },
  };
}
