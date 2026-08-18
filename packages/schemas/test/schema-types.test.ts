import type {
  CapabilityDecision,
  DocumentRecord,
  DocumentRegistry,
  HandoffBundle,
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

  it("keeps shared context provenance and handoff coordinates explicit", () => {
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
