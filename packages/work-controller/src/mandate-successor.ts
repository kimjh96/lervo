import type {
  MandateInstallationPlan,
  OperatingMandate,
  OperatingMandateV3,
} from "@lervo/application-contract";

import { assertOperatingMandate } from "./operating-contract-validation.js";
import { operatingContractHash } from "./operating-mandate-admission.js";

const SUCCESSOR_SUFFIX = /\.s([1-9][0-9]{0,3})$/u;

/** The lineage root of a supervision or mandate identifier, without any successor suffix. */
export function lineageRootId(id: string): string {
  return id.replace(SUCCESSOR_SUFFIX, "");
}

/** The absolute successor index encoded in an identifier; the lineage root is 0. */
export function successorIndexOf(id: string): number {
  const match = SUCCESSOR_SUFFIX.exec(id);
  return match === null ? 0 : Number(match[1]);
}

/** Deterministic identifier for the n-th successor of a lineage. */
export function successorId(parentId: string, successorIndex: number): string {
  if (!Number.isSafeInteger(successorIndex) || successorIndex < 1 || successorIndex > 1024)
    throw new Error("The successor index is out of bounds.");
  return `${lineageRootId(parentId)}.s${successorIndex}`;
}

export type SuccessorWorkScope = Pick<
  OperatingMandateV3["workScope"],
  "workstreamId" | "snapshotEventId" | "snapshotEventHash"
>;

/**
 * Builds the successor mandate the reviewed standing grant allows: identical bounds and
 * authority, one lineage index later, scoped to the successor goal's start snapshot.
 */
export function deriveSuccessorMandate(
  parent: OperatingMandate,
  input: { successorIndex: number; workScope: SuccessorWorkScope; issuedAt: string },
): OperatingMandateV3 {
  assertOperatingMandate(parent);
  if (parent.schemaVersion !== 3 || parent.successorAuthority === undefined)
    throw new Error("The parent mandate carries no successor authority.");
  if (input.successorIndex !== successorIndexOf(parent.mandateId) + 1)
    throw new Error("The successor index does not follow its parent.");
  if (
    !Number.isFinite(Date.parse(input.issuedAt)) ||
    Date.parse(input.issuedAt) < Date.parse(parent.issuedAt) ||
    Date.parse(input.issuedAt) >= Date.parse(parent.expiresAt)
  )
    throw new Error("The successor mandate is issued outside its parent's validity.");
  const remaining = parent.successorAuthority.maximumSuccessors - 1;
  const { successorAuthority: _parentAuthority, ...base } = parent;
  const mandate: OperatingMandateV3 = {
    ...structuredClone(base),
    mandateId: successorId(parent.mandateId, input.successorIndex),
    version: 1,
    issuedAt: input.issuedAt,
    revocationCoordinate: successorId(parent.revocationCoordinate, input.successorIndex),
    workScope: {
      schemaVersion: 1,
      workstreamId: input.workScope.workstreamId,
      snapshotEventId: input.workScope.snapshotEventId,
      snapshotEventHash: input.workScope.snapshotEventHash,
      excludedAssignments: [],
    },
    ...(remaining >= 1
      ? { successorAuthority: { schemaVersion: 1, maximumSuccessors: remaining } }
      : {}),
  };
  assertOperatingMandate(mandate);
  return mandate;
}

/** Verifies that a child mandate is exactly what its parent's standing grant permits. */
export function assertDerivedMandate(
  parent: OperatingMandate,
  child: OperatingMandate,
  derivation: NonNullable<MandateInstallationPlan["derivation"]>,
): void {
  if (
    derivation.schemaVersion !== 1 ||
    !/^evt_[a-f0-9]{32}$/u.test(derivation.parentInstallationEventId) ||
    derivation.parentMandateHash !== operatingContractHash(parent) ||
    child.schemaVersion !== 3
  )
    throw new Error("The mandate derivation does not bind its parent installation.");
  const expected = deriveSuccessorMandate(parent, {
    successorIndex: derivation.successorIndex,
    workScope: child.workScope,
    issuedAt: child.issuedAt,
  });
  if (operatingContractHash(expected) !== operatingContractHash(child))
    throw new Error("The derived mandate differs from what the standing grant permits.");
}
