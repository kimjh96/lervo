import type { OperatingMandate } from "./operating-mandate.js";

/** Current local authority observations; hashes bind the reviewed canonical inputs. */
export interface MandateInstallationSource {
  projectId: string;
  teamId: string;
  workstreamId: string;
  workstreamRevision: number;
  sourceRevisionDigest: string;
  causationEventIds: string[];
  ownerAgentId: string;
  eligible: boolean;
  reasonCodes: string[];
}

export interface MandateInstallationPlan {
  schemaVersion: 1;
  kind: "operating_mandate.installation";
  supervisionId: string;
  mandate: OperatingMandate;
  mandateHash: string;
  source: MandateInstallationSource;
  predecessorEventId: string | null;
  predecessorMandateHash: string | null;
  reviewerIdDigest: string;
  approvalHash: string;
}

export interface InstalledOperatingMandate {
  eventId: string;
  mandate: OperatingMandate;
  mandateHash: string;
  installationReviewHash: string;
  sourceRevisionDigest: string;
  revoked: boolean;
  latestEventId: string;
}
