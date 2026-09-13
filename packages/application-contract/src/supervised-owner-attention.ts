/** One unresolved decision for an exact semantic task basis; no authority or delivery claim. */
export interface SupervisedOwnerAttentionV1 {
  schemaVersion: 1;
  kind: "work.owner_attention";
  basisHash: string;
  reasonCode: string;
  rationaleArtifactHash: string;
  deadline: string;
}
