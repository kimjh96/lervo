import type {
  InstalledOperatingMandate,
  MandateInstallationPlan,
} from "@lervo/application-contract";
import {
  collectProjectEventsBounded,
  type ArtifactStore,
  type EventStore,
} from "@lervo/storage-contract";
import { assertCanonicalSupervisionIdentity } from "./supervision-identity.js";
import {
  assertDerivedMandate,
  assertMandateInstallationPlan,
  assertMandateExecutionSuccession,
  operatingContractHash,
  successorId,
  successorIndexOf,
} from "@lervo/work-controller";
import {
  SupervisionEventJournal,
  type SupervisionJournalCoordinates,
} from "./supervision-event-journal.js";
import {
  recordSupervisionPreflightAuthorityResolution,
  reviewSupervisionPreflightAuthorityChange,
} from "./supervision-preflight-resolution-journal.js";
import type {
  SQLiteSupervisionOwnerLeaseStore,
  SupervisionOwnerLease,
} from "./supervision-owner-lease.js";

/** Canonical installation evidence. Consumers must revalidate current authority before any effect. */
export class SupervisionMandateJournal {
  private readonly journal: SupervisionEventJournal;

  constructor(
    private readonly events: EventStore,
    artifacts: ArtifactStore,
    private readonly coordinates: SupervisionJournalCoordinates,
    private readonly now: () => string,
    fence: { store: SQLiteSupervisionOwnerLeaseStore; lease: SupervisionOwnerLease } | null,
  ) {
    this.coordinates = structuredClone(coordinates);
    this.journal = new SupervisionEventJournal(events, artifacts, coordinates, now, fence);
  }

  async current(): Promise<InstalledOperatingMandate | null> {
    let current: InstalledOperatingMandate | null = null;
    for (const event of this.journal.history()) {
      if (event.type === "work.supervision.mandate.installed") {
        this.journal.assertEventBinding(event);
        const plan = (await this.journal.read(
          String(event.payload.installationReviewHash),
        )) as MandateInstallationPlan;
        assertMandateInstallationPlan(plan);
        assertMandateExecutionSuccession(current, plan.mandate);
        if (plan.derivation !== undefined) await this.assertDerivation(plan);
        const mandate = await this.journal.read(String(event.payload.mandateArtifactHash));
        if (
          operatingContractHash(mandate) !== plan.mandateHash ||
          event.payload.mandateHash !== plan.mandateHash ||
          event.payload.mandateId !== plan.mandate.mandateId ||
          event.payload.mandateVersion !== plan.mandate.version ||
          event.payload.reviewerIdDigest !== plan.reviewerIdDigest ||
          event.payload.predecessorMandateHash !== (current?.mandateHash ?? null) ||
          plan.predecessorEventId !== (current?.latestEventId ?? null) ||
          plan.predecessorMandateHash !== (current?.mandateHash ?? null) ||
          event.payload.ownerAgentId !== plan.mandate.ownerAgentId ||
          event.payload.workstreamRevision !== plan.source.workstreamRevision ||
          operatingContractHash(event.payload.causationEventIds) !==
            operatingContractHash(plan.source.causationEventIds) ||
          (current !== null &&
            (plan.mandate.mandateId !== current.mandate.mandateId ||
              plan.mandate.version <= current.mandate.version ||
              plan.mandate.appointingAuthorityId !== current.mandate.appointingAuthorityId))
        )
          throw new Error("The installed mandate history conflicts with its reviewed artifacts.");
        this.assertBinding(plan);
        current = {
          eventId: event.eventId,
          mandate: plan.mandate,
          mandateHash: plan.mandateHash,
          installationReviewHash: String(event.payload.installationReviewHash),
          sourceRevisionDigest: plan.source.sourceRevisionDigest,
          revoked: false,
          latestEventId: event.eventId,
        };
      } else if (event.type === "work.supervision.mandate.revoked") {
        this.journal.assertEventBinding(event);
        if (
          current === null ||
          current.revoked ||
          event.payload.mandateHash !== current.mandateHash ||
          event.payload.mandateId !== current.mandate.mandateId ||
          event.payload.revocationCoordinateHash !==
            operatingContractHash({ revocationCoordinate: current.mandate.revocationCoordinate }) ||
          event.payload.reviewerIdDigest !==
            operatingContractHash({ reviewerId: current.mandate.appointingAuthorityId }) ||
          operatingContractHash(event.payload.causationEventIds) !==
            operatingContractHash([current.eventId])
        )
          throw new Error("The mandate revocation conflicts with its installation.");
        current.revoked = true;
        current.latestEventId = event.eventId;
      }
    }
    return current;
  }

  /** The exact review a reviewer must approve before a block may be resolved by this mandate. */
  async reviewPreflightResolution(blockedEventId: string, reviewerId: string) {
    const installation = await this.current();
    if (installation === null) throw new Error("There is no installed mandate.");
    return reviewSupervisionPreflightAuthorityChange({
      events: this.events,
      coordinates: this.coordinates,
      installation,
      blockedEventId,
      reviewerId,
    });
  }

  async resolvePreflight(blockedEventId: string, reviewerId: string, approval: string) {
    const installation = await this.current();
    if (installation === null) throw new Error("There is no installed mandate.");
    return recordSupervisionPreflightAuthorityResolution({
      journal: this.journal,
      events: this.events,
      coordinates: this.coordinates,
      installation,
      blockedEventId,
      reviewerId,
      approval,
    });
  }

  async install(
    plan: MandateInstallationPlan,
    approval: string,
    revalidate: () => Promise<void>,
  ): Promise<InstalledOperatingMandate> {
    plan = structuredClone(plan);
    assertMandateInstallationPlan(plan);
    this.assertBinding(plan);
    if (plan.derivation !== undefined) await this.assertDerivation(plan, true);
    if (
      plan.mandate.ownerAgentId !== this.coordinates.ownerAgentId ||
      plan.source.workstreamRevision !== this.coordinates.workstreamRevision
    )
      throw new Error(
        "The mandate installation differs from its owner fence or workstream revision.",
      );
    if (approval !== plan.approvalHash)
      throw new Error("The mandate installation approval is stale.");
    const current = await this.current();
    const eventId = this.journal.eventId("work.supervision.mandate.installed", plan.approvalHash);
    if (current?.eventId === eventId && !current.revoked) return current;
    assertMandateExecutionSuccession(current, plan.mandate);
    if (
      (current?.latestEventId ?? null) !== plan.predecessorEventId ||
      (current?.mandateHash ?? null) !== plan.predecessorMandateHash ||
      Date.parse(this.now()) < Date.parse(plan.mandate.issuedAt) ||
      Date.parse(this.now()) >= Date.parse(plan.mandate.expiresAt) ||
      (current !== null &&
        (plan.mandate.mandateId !== current.mandate.mandateId ||
          plan.mandate.version <= current.mandate.version ||
          plan.mandate.appointingAuthorityId !== current.mandate.appointingAuthorityId))
    )
      throw new Error("The mandate installation predecessor or validity changed.");
    for (const id of plan.source.causationEventIds)
      if (this.events.get(id)?.projectId !== this.coordinates.projectId)
        throw new Error("The mandate installation cause is unavailable.");
    const mandateArtifactHash = await this.journal.put(plan.mandate);
    const installationReviewHash = await this.journal.put(plan);
    await revalidate();
    // Recheck after asynchronous CAS writes; a stale caller cannot replace a newer installation.
    if ((await this.current())?.latestEventId !== current?.latestEventId)
      throw new Error("The mandate installation predecessor changed.");
    this.journal.append(
      "work.supervision.mandate.installed",
      {
        ...this.common(plan.mandateHash, plan.mandate.ownerAgentId),
        causationEventIds: plan.source.causationEventIds,
        mandateId: plan.mandate.mandateId,
        mandateVersion: plan.mandate.version,
        mandateArtifactHash,
        installationReviewHash,
        reviewerIdDigest: plan.reviewerIdDigest,
        predecessorMandateHash: plan.predecessorMandateHash,
      },
      plan.approvalHash,
      () => {
        this.assertHead(current?.latestEventId ?? null);
        assertCanonicalSupervisionIdentity({
          ...this.coordinates,
          events: collectProjectEventsBounded({ events: this.events, maximumEvents: 100_000 }),
        });
      },
    );
    return (await this.current())!;
  }

  async revoke(input: {
    mandateHash: string;
    installationEventId: string;
    reviewerId: string;
  }): Promise<InstalledOperatingMandate> {
    input = structuredClone(input);
    const current = await this.current();
    if (
      current === null ||
      current.mandateHash !== input.mandateHash ||
      current.eventId !== input.installationEventId ||
      current.mandate.appointingAuthorityId !== input.reviewerId ||
      current.mandate.ownerAgentId !== this.coordinates.ownerAgentId
    )
      throw new Error("The mandate revocation authority or installation changed.");
    if (current.revoked) return current;
    this.journal.append(
      "work.supervision.mandate.revoked",
      {
        ...this.common(current.mandateHash, current.mandate.ownerAgentId),
        causationEventIds: [current.eventId],
        mandateId: current.mandate.mandateId,
        revocationCoordinateHash: operatingContractHash({
          revocationCoordinate: current.mandate.revocationCoordinate,
        }),
        reviewerIdDigest: operatingContractHash({ reviewerId: input.reviewerId }),
      },
      current.eventId,
      () => this.assertHead(current.latestEventId),
    );
    return (await this.current())!;
  }

  /**
   * A derived successor plan is admitted only by the exact reviewed grant of its parent
   * installation: same lineage, next index, identical bounds, and an unrevoked parent.
   */
  private async assertDerivation(
    plan: MandateInstallationPlan,
    requireUnrevokedParent = false,
  ): Promise<void> {
    const derivation = plan.derivation!;
    const parent = this.events.get(derivation.parentInstallationEventId);
    if (
      parent === null ||
      parent.type !== "work.supervision.mandate.installed" ||
      parent.projectId !== this.coordinates.projectId ||
      parent.payload.mandateHash !== derivation.parentMandateHash ||
      parent.payload.ownerAgentId !== plan.mandate.ownerAgentId
    )
      throw new Error("The mandate derivation has no exact parent installation.");
    const parentPlan = (await this.journal.read(
      String(parent.payload.installationReviewHash),
    )) as MandateInstallationPlan;
    assertMandateInstallationPlan(parentPlan);
    if (
      parentPlan.mandateHash !== derivation.parentMandateHash ||
      parentPlan.supervisionId !== String(parent.payload.supervisionId) ||
      successorIndexOf(parentPlan.supervisionId) !== derivation.successorIndex - 1 ||
      plan.supervisionId !== successorId(parentPlan.supervisionId, derivation.successorIndex) ||
      plan.source.workstreamId === parentPlan.source.workstreamId
    )
      throw new Error("The mandate derivation does not continue its parent lineage.");
    assertDerivedMandate(parentPlan.mandate, plan.mandate, derivation);
    if (
      requireUnrevokedParent &&
      collectProjectEventsBounded({ events: this.events, maximumEvents: 100_000 }).some(
        (event) =>
          event.type === "work.supervision.mandate.revoked" &&
          event.payload.mandateHash === derivation.parentMandateHash,
      )
    )
      throw new Error("The mandate derivation parent is revoked.");
  }

  private assertBinding(plan: MandateInstallationPlan): void {
    if (
      plan.supervisionId !== this.coordinates.supervisionId ||
      plan.source.projectId !== this.coordinates.projectId ||
      plan.source.workstreamId !== this.coordinates.workstreamId
    )
      throw new Error("The mandate installation journal binding changed.");
  }

  private assertHead(expected: string | null): void {
    const latest = this.journal
      .history()
      .findLast(
        (event) =>
          event.type === "work.supervision.mandate.installed" ||
          event.type === "work.supervision.mandate.revoked",
      );
    if ((latest?.eventId ?? null) !== expected)
      throw new Error("The mandate installation predecessor changed.");
  }

  private common(mandateHash: string, ownerAgentId: string) {
    return {
      schemaVersion: 1,
      projectId: this.coordinates.projectId,
      workstreamId: this.coordinates.workstreamId,
      workstreamRevision: this.coordinates.workstreamRevision,
      supervisionId: this.coordinates.supervisionId,
      ownerAgentId,
      mandateHash,
    };
  }
}
