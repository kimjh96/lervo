import { afterEach, describe, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({
  owner: vi.fn<() => Promise<"delegation" | "continuity_policy" | null>>(),
}));

vi.mock("../src/knowledge-command.js", () => ({
  runKnowledgeCommand: vi.fn(),
  runKnowledgeMigration: async (input: { io: { stdout(message: string): void } }) => {
    input.io.stdout(
      `${JSON.stringify({
        planKind: "document_normalization_provider_selection",
        status: "provider_required",
        pendingDocuments: ["CLAUDE.md", "docs/architecture/system.md", "docs/specs/runtime.md"],
        supportedProviders: ["codex", "claude"],
      })}\n`,
    );
    return 0;
  },
}));
vi.mock("../src/knowledge-background-owner.js", () => ({
  knowledgeBackgroundOwner: ports.owner,
}));

const { inspectKnowledge } = await import("../src/upgrade-stage-inspection.js");

afterEach(() => ports.owner.mockReset());

describe("upgrade knowledge stage ownership", () => {
  it("reports normalization debt as background-owned when the resident has a delegation", async () => {
    ports.owner.mockResolvedValue("delegation");
    expect(await inspectKnowledge("/repository")).toEqual({
      disposition: "current",
      planKind: "document_normalization_provider_selection",
      planId: null,
      status: "provider_required",
      reason: "background_owned",
      blockers: [],
      backgroundDebt: { owner: "delegation", pendingDocuments: 3 },
    });
  });

  it("counts a host continuity policy as an automatic owner", async () => {
    ports.owner.mockResolvedValue("continuity_policy");
    expect(await inspectKnowledge("/repository")).toMatchObject({
      disposition: "current",
      reason: "background_owned",
      backgroundDebt: { owner: "continuity_policy", pendingDocuments: 3 },
    });
  });

  it("keeps provider selection with the owner when nothing would drain the debt", async () => {
    ports.owner.mockResolvedValue(null);
    expect(await inspectKnowledge("/repository")).toEqual({
      disposition: "pending_authority",
      planKind: "document_normalization_provider_selection",
      planId: null,
      status: "provider_required",
      reason: "provider_required",
      blockers: [],
    });
  });
});
