import type {
  CapabilityDecision,
  DocumentRecord,
  DocumentRegistry,
  DocumentManifest,
  DocumentMigrationApproval,
  DocumentMigrationApplyReceipt,
  DocumentMigrationCandidate,
  DocumentMigrationPlan,
  HandoffBundle,
  LegacyRegistryEntryArtifact,
  LegacyRegistryMigrationPlan,
  RoleProfile,
  SharedContextPublication,
  SkillManifest,
} from "../src/index.js";
import { describe, expectTypeOf, it } from "vitest";

describe("schema-derived TypeScript contracts", () => {
  it("keeps every role capability decision explicit", () => {
    expectTypeOf<RoleProfile["capabilities"]["deploy"]>().toEqualTypeOf<CapabilityDecision>();
    expectTypeOf<RoleProfile["contextPolicy"]["minimumAssurance"]>().toEqualTypeOf<"E3">();
    expectTypeOf<RoleProfile["outputContract"]["presentation"]>().toMatchTypeOf<
      | { audience: "machine"; writingPolicyId: null }
      | { audience: "human" | "mixed"; locale: string; writingPolicyId: string }
    >();
  });

  it("keeps skill trust as a discriminated union", () => {
    type VerifiedSkill = Extract<SkillManifest["trust"], { level: "verified" }>;
    expectTypeOf<VerifiedSkill["signatureStatus"]>().toEqualTypeOf<"valid">();
  });

  it("types document ids as a map of document records", () => {
    expectTypeOf<DocumentRegistry["documents"]>().toMatchTypeOf<
      Record<string, DocumentRecord>
    >();
  });

  it("keeps document ownership and bounded content policy aligned", () => {
    type GeneratedManifest = DocumentManifest & {
      record: { ownership: { mode: "lervo_generated" } };
      contentPolicy: { mode: "lervo_generated" };
    };
    expectTypeOf<GeneratedManifest["contentPolicy"]["historyMode"]>()
      .toEqualTypeOf<"separate_documents">();
    expectTypeOf<GeneratedManifest["contentPolicy"]["maxDocumentBytes"]>()
      .toEqualTypeOf<65536>();
  });

  it("keeps migration discovery read-only and source-hash bound", () => {
    expectTypeOf<DocumentMigrationPlan["writesAllowed"]>().toEqualTypeOf<false>();
    expectTypeOf<DocumentMigrationPlan["mode"]>().toEqualTypeOf<"dry_run">();
    expectTypeOf<DocumentMigrationCandidate["source"]["contentHash"]>()
      .toEqualTypeOf<string>();
  });

  it("requires reviewed sidecars and returns a hash-only apply event payload", () => {
    type Approved = Extract<
      DocumentMigrationApproval["decisions"][number],
      { action: "approve_sidecar" }
    >;
    expectTypeOf<Approved["manifest"]>().toEqualTypeOf<DocumentManifest>();
    expectTypeOf<DocumentMigrationApplyReceipt["eventPayload"]["approvalDigest"]>()
      .toEqualTypeOf<string>();
    expectTypeOf<DocumentMigrationApplyReceipt["eventPayload"]["afterLayoutHash"]>()
      .toEqualTypeOf<string>();
  });

  it("keeps legacy registry migration read-only and preserves each original record", () => {
    expectTypeOf<LegacyRegistryMigrationPlan["writesAllowed"]>().toEqualTypeOf<false>();
    expectTypeOf<LegacyRegistryMigrationPlan["source"]["deactivationAction"]>()
      .toEqualTypeOf<"archive_then_remove">();
    expectTypeOf<LegacyRegistryEntryArtifact["record"]>().toEqualTypeOf<DocumentRecord>();
  });

  it("keeps shared context plervoance and handoff coordinates explicit", () => {
    type AgentPublication = SharedContextPublication & {
      producer: { kind: "agent" };
    };
    expectTypeOf<AgentPublication["producer"]>().toMatchTypeOf<{
      roleId: string;
      runId: string;
      sessionId: string;
    }>();
    expectTypeOf<HandoffBundle["from"]["contextGeneration"]>().toEqualTypeOf<number>();
    expectTypeOf<RoleProfile["handoff"]["sharedContextRequired"]>().toEqualTypeOf<true>();
  });
});
