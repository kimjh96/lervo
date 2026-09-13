/** One budgeted observation-only owner model invocation, before any proposed business effect. */
export interface SupervisedOwnerReasoningV1 {
  schemaVersion: 1;
  kind: "work.owner_reasoning";
  basisHash: string;
  contextArtifactHash: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  provider: "codex" | "claude";
  requestedModel: string | null;
  reservedTokens: number;
  attemptNumber: number;
  deadline: string;
}
