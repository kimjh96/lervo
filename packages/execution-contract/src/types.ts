import type {
  AdapterCapabilityActivationReceipt,
  AdapterSession,
  AdapterTurn,
  ContextEvidence,
  VerificationResult,
  WorkCausalityRecordedEventPayload,
  ProviderModelIdentity,
} from "@lervo/schemas";

export interface ManagedFileChangeEvidence {
  path: string;
  beforeHash: string | null;
  afterHash: string | null;
  changeKind: "created" | "modified" | "deleted";
}

export interface ManagedProviderResultArtifact {
  artifactId: string;
  uri: string;
  mediaType: "text/markdown; charset=utf-8";
  contentHash: string;
  byteCount: number;
}

export interface ManagedVerificationResultArtifact {
  artifactId: string;
  uri: string;
  mediaType: "application/vnd.lervo.verification-result+json; charset=utf-8";
  contentHash: string;
  byteCount: number;
}

export interface ManagedProjectVerification {
  result: VerificationResult;
  resultArtifact: ManagedVerificationResultArtifact;
}

export interface ManagedProviderRunResult {
  status: "completed";
  workCausality: WorkCausalityRecordedEventPayload;
  session: AdapterSession;
  turn: AdapterTurn;
  terminalEventId: string;
  resultArtifact: ManagedProviderResultArtifact;
  modelIdentity: ProviderModelIdentity;
  contextEvidence: readonly ContextEvidence[];
  capabilityActivations: AdapterCapabilityActivationReceipt[];
  managedChanges: ManagedFileChangeEvidence[];
  contextGeneration: number;
  beforeRevision: string;
  beforeCommits?: Readonly<Record<string, string>>;
  afterRevision: string;
  verificationStatus: "passed" | "failed" | "not_run";
  verifications: ManagedProjectVerification[];
}
