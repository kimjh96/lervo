export type EnvironmentScope = "project" | "user" | "organization";
export type EnvironmentSharing = "local_only" | "normalized_observations";
export type EnvironmentAdmissionDecision = "auto_register" | "review_required" | "deny";
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

export interface EnvironmentSourceManifest {
  schemaVersion: 1;
  sourceId: string;
  adapterId: string;
  scope: EnvironmentScope;
  capabilities: string[];
  maximumValiditySeconds: number;
  sharing: EnvironmentSharing;
  configuration: Record<string, JsonValue>;
}

export interface EnvironmentSourceCandidate {
  manifest: EnvironmentSourceManifest;
  discoveredBy: string;
  evidence: Array<{
    kind: string;
    observedAt: string;
  }>;
}

export interface EnvironmentAdmissionRule {
  ruleId: string;
  adapterId: string;
  scopes?: EnvironmentScope[];
  capabilities?: string[];
  decision: EnvironmentAdmissionDecision;
}

export interface EnvironmentAdmissionPolicy {
  schemaVersion: 1;
  defaultDecision: EnvironmentAdmissionDecision;
  rules: EnvironmentAdmissionRule[];
}

export interface EnvironmentAdmissionResult {
  decision: EnvironmentAdmissionDecision;
  ruleId: string | null;
  reason: "matching_rule" | "default_policy";
}

export interface EnvironmentEndpoint {
  transport: string;
  addressKind: "dns" | "ip" | "local";
  host: string;
  port?: number;
}

export interface EnvironmentSubject {
  subjectId: string;
  kind: "device" | "service" | "runtime";
  labels: Record<string, string>;
  capabilities: string[];
  endpoints: EnvironmentEndpoint[];
}

export interface EnvironmentVerification {
  kind: string;
  status: "verified" | "unavailable";
  checkedAt: string;
  failureCode?: string;
}

export interface EnvironmentObservation {
  schemaVersion: 1;
  sourceId: string;
  adapterId: string;
  scope: EnvironmentScope;
  status: "available" | "unavailable";
  observedAt: string;
  validUntil: string;
  subjects: EnvironmentSubject[];
  verification: EnvironmentVerification[];
}

export interface AdapterEnvironmentSnapshot {
  status: "available" | "unavailable";
  subjects: EnvironmentSubject[];
  verification: Array<Omit<EnvironmentVerification, "checkedAt">>;
}

export interface EnvironmentSourceAdapter {
  readonly id: string;
  query(input: {
    source: EnvironmentSourceManifest;
    signal?: AbortSignal;
  }): Promise<AdapterEnvironmentSnapshot>;
}

export interface EnvironmentTargetManifest {
  schemaVersion: 1;
  targetId: string;
  requiredCapabilities: string[];
  selectors: Array<{ label: string; equals: string }>;
  preferredSourceIds: string[];
}

export interface EnvironmentResolutionCandidate {
  sourceId: string;
  subject: EnvironmentSubject;
  observedAt: string;
}

export type EnvironmentResolution =
  | { status: "resolved"; targetId: string; candidate: EnvironmentResolutionCandidate }
  | { status: "unresolved"; targetId: string; reason: "no_fresh_verified_match" }
  | { status: "ambiguous"; targetId: string; candidates: EnvironmentResolutionCandidate[] };
