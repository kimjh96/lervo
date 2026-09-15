import type {
  InstalledOperatingMandate,
  MandateInstallationSource,
} from "@lervo/application-contract";
import { SupervisionMandateJournal } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { operatingContractHash } from "@lervo/work-controller";
import { observeMandateInstallationSource } from "./supervision-authority-source.js";
import type { SupervisionAuthorityHistory } from "./supervision-authority-history.js";

export interface NodeSupervisionBinding {
  supervisionId: string;
  workstreamId: string;
  ownerAgentId: string;
  mandateHash: string;
}

export class NodeSupervisionError extends Error {
  constructor(
    readonly code:
      | "supervision_binding_invalid"
      | "supervision_authority_unavailable"
      | "supervision_authority_changed"
      | "supervision_session_closed"
      | "supervision_readiness_changed"
      | "supervision_readiness_stale"
      | "supervision_knowledge_snapshot_changed",
  ) {
    super(`Node supervision failed: ${code}.`);
    this.name = "NodeSupervisionError";
  }
}

export function assertNodeSupervisionBinding(binding: NodeSupervisionBinding): void {
  if (
    !/^[a-z][a-z0-9_.:-]{0,127}$/u.test(binding.supervisionId) ||
    !/^wks_[a-f0-9]{24}$/u.test(binding.workstreamId) ||
    !/^agt_[a-f0-9]{24}$/u.test(binding.ownerAgentId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(binding.mandateHash)
  )
    throw new NodeSupervisionError("supervision_binding_invalid");
}

export function supervisionJournalCoordinates(
  storage: ProjectStorage,
  binding: NodeSupervisionBinding,
  workstreamRevision: number,
) {
  return {
    ...binding,
    projectId: storage.manifest.projectId,
    workstreamRevision,
    sessionId: `ses_${operatingContractHash(binding).slice(7, 39)}`,
    policyVersion: operatingContractHash({ contract: "node.supervision.authority.v1" }),
  };
}

export async function readInstalledNodeMandate(
  storage: ProjectStorage,
  binding: NodeSupervisionBinding,
  now: () => string,
): Promise<InstalledOperatingMandate> {
  const current = await new SupervisionMandateJournal(
    storage.events,
    storage.artifacts,
    supervisionJournalCoordinates(storage, binding, 1),
    now,
    null,
  ).current();
  if (
    current === null ||
    current.mandateHash !== binding.mandateHash ||
    current.mandate.ownerAgentId !== binding.ownerAgentId
  )
    throw new NodeSupervisionError("supervision_binding_invalid");
  return current;
}

/** A live local authority observation; reader capability and sync health never prove convergence. */
export async function observeNodeSupervisionAuthority(
  storage: ProjectStorage,
  binding: NodeSupervisionBinding,
  now: () => string,
  authorityHistory?: SupervisionAuthorityHistory,
): Promise<{
  installation: InstalledOperatingMandate;
  source: MandateInstallationSource;
  observedAt: string;
}> {
  const observation = await observeNodeSupervisionRecoveryAuthority(
    storage,
    binding,
    now,
    authorityHistory,
  );
  const { installation } = observation;
  if (
    installation.revoked ||
    Date.parse(now()) < Date.parse(installation.mandate.issuedAt) ||
    Date.parse(now()) >= Date.parse(installation.mandate.expiresAt)
  )
    throw new NodeSupervisionError("supervision_authority_unavailable");
  return observation;
}

/** Observes exact authority after expiry or revocation; never grants new effect admission. */
/**
 * Authority to settle a historical run under an installed mandate. Writing a terminal for a run
 * that never ended grants no execution, reopens no assignment and publishes nothing, so it does
 * not require the run's goal to still be current. It requires an unrevoked, unexpired installation
 * for the exact supervision and owner, and an installation that does not change while it is read.
 */
export async function observeNodeSupervisionSettlementAuthority(
  storage: ProjectStorage,
  binding: NodeSupervisionBinding,
  now: () => string,
) {
  const started = Date.parse(now());
  const installation = await readInstalledNodeMandate(storage, binding, now);
  const confirmed = await readInstalledNodeMandate(storage, binding, now);
  const observedAt = now();
  const elapsed = Date.parse(observedAt) - started;
  if (
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    elapsed > 5000 ||
    confirmed.latestEventId !== installation.latestEventId ||
    installation.revoked ||
    installation.mandate.ownerAgentId !== binding.ownerAgentId ||
    Date.parse(observedAt) >= Date.parse(installation.mandate.expiresAt)
  )
    throw new NodeSupervisionError("supervision_authority_changed");
  return { installation, observedAt };
}

export async function observeNodeSupervisionRecoveryAuthority(
  storage: ProjectStorage,
  binding: NodeSupervisionBinding,
  now: () => string,
  authorityHistory?: SupervisionAuthorityHistory,
) {
  const started = Date.parse(now());
  const installation = await readInstalledNodeMandate(storage, binding, now);
  const source = await observeMandateInstallationSource(
    storage.paths.repositoryRoot,
    storage,
    installation.mandate,
    "current",
    authorityHistory,
  );
  const confirmed = await readInstalledNodeMandate(storage, binding, now);
  const observedAt = now();
  const elapsed = Date.parse(observedAt) - started;
  if (
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    elapsed > 5000 ||
    source.workstreamId !== binding.workstreamId ||
    confirmed.latestEventId !== installation.latestEventId
  )
    throw new NodeSupervisionError("supervision_authority_changed");
  return { installation, source, observedAt };
}
