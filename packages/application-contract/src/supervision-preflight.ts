/** Private, bounded witness metadata for a proved pre-effect non-start; no request or provider text. */
export interface SupervisionPreflightInspectionV1 {
  schemaVersion: 1;
  kind: "work.supervision.preflight_inspection";
  failurePhase: "admission" | "readiness" | "authority";
  reasonCode: string;
  finalAdmission: null | {
    snapshotHash: string;
    observedAt: string;
    disposition: "admitted" | "blocked" | null;
  };
  finalReadiness: null | {
    observationHash: string;
    observedAt: string;
    validUntil: string;
    failedCheckKinds: string[];
    unobservedCheckKinds: string[];
  };
}
