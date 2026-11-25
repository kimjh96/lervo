import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, expect, it, vi } from "vitest";
import { prepareTerminalPromptContext } from "../src/terminal-prompt-context.js";
import { prefetchRepositoryHealth } from "../src/repository-health-prefetch.js";
import { publishRepositoryHealth } from "../src/repository-health-publication.js";
import { captureTerminalRepositorySnapshot } from "../src/terminal-repository-snapshot.js";
import { lintRepositoryKnowledge } from "@lervo/repository-knowledge";
import { healthyProjection } from "./repository-health-fixture.js";

vi.mock("../src/repository-health-prefetch.js", () => ({
  prefetchRepositoryHealth: vi.fn(() => {
    throw new Error("Projection computed on prompt path");
  }),
}));
vi.mock("@lervo/repository-knowledge", async (original) => ({
  ...(await original<typeof import("@lervo/repository-knowledge")>()),
  lintRepositoryKnowledge: vi.fn(() => {
    throw new Error("Lint run on prompt path");
  }),
}));

let root: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

it.each(["codex", "claude"] as const)(
  "%s compact turns read cached health without provider, projection or lint work",
  async (provider) => {
    root = await mkdtemp(resolve(tmpdir(), "lervo-health-prompt-"));
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_healthprompt" }));
    const snapshot = await captureTerminalRepositorySnapshot(root);
    const projection = healthyProjection();
    projection.repositoryRevision = snapshot.revision;
    const now = new Date();
    projection.observedAt = now.toISOString();
    for (const measure of Object.values(projection.measures)) {
      measure.observedAt = now.toISOString();
      measure.validUntil = new Date(now.getTime() + 1_200_000).toISOString();
    }
    Object.assign(projection.measures.freshness.value!, {
      evaluationObservedAt: now.toISOString(),
      evaluationValidUntil: new Date(now.getTime() + 86_400_000).toISOString(),
      cycleObservedAt: now.toISOString(),
      cycleValidUntil: new Date(now.getTime() + 86_400_000).toISOString(),
    });
    projection.measures.freshness.validUntil = new Date(now.getTime() + 86_400_000).toISOString();
    projection.measures.find.value!.lastInjectedAt = now.toISOString();
    projection.measures.freshness.status = "gap";
    projection.measures.freshness.value!.stale = 1;
    await publishRepositoryHealth(root, projection);
    const result = await prepareTerminalPromptContext({
      root,
      provider,
      prompt: "Continue",
      observationId: "tobs_healthprompt",
      workspaceBinding: null,
      timing: {
        measure: async (_id, run) => run(),
        measureChild: async (_id, _parent, run) => run(),
        finalize: () => null,
      },
    });
    expect(result.additionalContext).toContain("1/10 evaluated documents stale");
    expect(result.additionalContext).not.toContain("Document freshness:");
    expect(result.additionalContext).not.toContain("Instruction capture:");
    // The reader re-expires freshness and names its two state sources instead of the fixture.
    expect(result.attention.health?.measures.freshness).toEqual({
      ...projection.measures.freshness,
      source: [
        ".lervo/state/knowledge/document-staleness.json",
        ".lervo/state/knowledge/freshness-cycle.json",
      ],
    });
    expect(prefetchRepositoryHealth).not.toHaveBeenCalled();
    expect(lintRepositoryKnowledge).not.toHaveBeenCalled();
  },
);
