const HASH = /^sha256:[a-f0-9]{64}$/u;
const INVOCATION_ID = /^[a-f0-9]{32}$/u;

export interface UnitInvocationWitness {
  schemaVersion: 1;
  kind: "host.unit_invocation_witness";
  unit: string;
  incidentAt: string;
  incidentInvocationId: string;
  incidentInvocationFirstAt: string;
  incidentInvocationLastAt: string;
  successorInvocationId: string;
  successorInvocationFirstAt: string;
  currentInvocationId: string;
  inventorySha256: string;
  observedAt: string;
}

/** A completed successor invocation fences the incident process; the proof never estimates usage. */
export function validUnitInvocationWitness(
  value: unknown,
  incidentAt: string,
  evidenceEventAt: string,
): value is UnitInvocationWitness {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const witness = value as Record<string, unknown>;
  if (
    Object.keys(witness).sort().join(",") !==
      [
        "schemaVersion",
        "kind",
        "unit",
        "incidentAt",
        "incidentInvocationId",
        "incidentInvocationFirstAt",
        "incidentInvocationLastAt",
        "successorInvocationId",
        "successorInvocationFirstAt",
        "currentInvocationId",
        "inventorySha256",
        "observedAt",
      ]
        .sort()
        .join(",") ||
    witness.schemaVersion !== 1 ||
    witness.kind !== "host.unit_invocation_witness" ||
    typeof witness.unit !== "string" ||
    !/^[A-Za-z0-9@._-]{1,128}$/u.test(witness.unit) ||
    !INVOCATION_ID.test(String(witness.incidentInvocationId)) ||
    !INVOCATION_ID.test(String(witness.successorInvocationId)) ||
    !INVOCATION_ID.test(String(witness.currentInvocationId)) ||
    witness.incidentInvocationId === witness.successorInvocationId ||
    witness.incidentInvocationId === witness.currentInvocationId ||
    !HASH.test(String(witness.inventorySha256)) ||
    witness.incidentAt !== incidentAt
  )
    return false;
  const first = Date.parse(String(witness.incidentInvocationFirstAt));
  const incident = Date.parse(incidentAt);
  const last = Date.parse(String(witness.incidentInvocationLastAt));
  const successor = Date.parse(String(witness.successorInvocationFirstAt));
  const observed = Date.parse(String(witness.observedAt));
  const evidence = Date.parse(evidenceEventAt);
  return (
    [first, incident, last, successor, observed, evidence].every(Number.isFinite) &&
    first <= incident &&
    incident <= last &&
    last <= successor &&
    successor <= observed &&
    observed <= evidence &&
    evidence - observed <= 5_000
  );
}
