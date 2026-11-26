import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareTerminalBaseContext,
  prepareTerminalBaseParts,
} from "../src/terminal-degraded-context.js";
import { formatDegradedTerminalContext } from "../src/terminal-compact-format.js";
import { TERMINAL_HOOK_BUDGET_MS } from "../src/terminal-hook-budget.js";

const ports = vi.hoisted(() => ({
  policy: vi.fn(),
  instructions: vi.fn(),
  workstream: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@lervo/repository-context", () => ({
  prepareAppliedInstructionContext: ports.instructions,
}));
vi.mock("@lervo/project-storage", () => ({
  openProjectStorage: async () => ({ close: ports.close }),
}));
vi.mock("@lervo/repository-knowledge", async (original) => ({
  ...(await original<typeof import("@lervo/repository-knowledge")>()),
  loadRepositoryKnowledgePolicy: ports.policy,
}));
vi.mock("../src/workstream-services.js", () => ({ verifiedCurrentWorkstream: ports.workstream }));
beforeEach(() => {
  vi.resetAllMocks();
  ports.policy.mockResolvedValue({ publication: { language: "en" } });
  ports.instructions.mockResolvedValue({
    report: { status: "complete", preparedCount: 1 },
    context: "Applied owner rule: preserve the full owner clause.",
  });
  ports.workstream.mockResolvedValue({
    title: "Recorded work",
    revision: 7,
    nextActions: ["Do not claim this is fresh"],
  });
});
afterEach(() => vi.useRealTimers());

describe("independent compact fallback", () => {
  it("keeps verified local configuration and clauses without claiming knowledge or workstream freshness", async () => {
    const context = formatDegradedTerminalContext(
      await prepareTerminalBaseContext("/repository"),
      "repository_snapshot_limit_exceeded",
    );
    expect(context).toContain("AGENTS.md");
    expect(context).toContain("publication.language=en; writingPolicyId=writing_en-human");
    expect(context).toContain("preserve the full owner clause");
    expect(context).toContain("provider delivery unobserved");
    expect(context).toContain("Lervo workstream: Recorded work (revision 7).");
    expect(context).toContain("freshness was not inspected");
    expect(context).not.toContain("Do not claim this is fresh");
    expect(context).not.toContain("Background knowledge convergence is active");
    expect(context).not.toContain("Document freshness:");
    expect(ports.close).toHaveBeenCalledOnce();
    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(4096);
  });

  it("omits failed policy and workstream reads while keeping independently prepared clauses", async () => {
    ports.policy.mockRejectedValue(new Error("private detail"));
    ports.workstream.mockRejectedValue(new Error("private detail"));
    const context = formatDegradedTerminalContext(
      await prepareTerminalBaseContext("/repository"),
      "knowledge_inspection_failed",
    );
    expect(context).toContain("preserve the full owner clause");
    expect(context).not.toContain("publication.language=");
    expect(context).not.toContain("Lervo workstream:");
    expect(context).not.toContain("private detail");
  });

  it("bounds a hung optional read and retains the other base lines", async () => {
    vi.useFakeTimers();
    ports.instructions.mockImplementation(() => new Promise(() => undefined));
    const pending = prepareTerminalBaseContext("/repository");
    await vi.advanceTimersByTimeAsync(TERMINAL_HOOK_BUDGET_MS / 6 + 1);
    const context = formatDegradedTerminalContext(await pending, "hook_deadline_exceeded");
    expect(context).toContain("publication.language=en");
    expect(context).toContain("Lervo workstream:");
    expect(context).not.toContain("Applied owner rules:");
  });

  it("caps optional reads at the remaining shared budget", async () => {
    vi.useFakeTimers();
    ports.instructions.mockImplementation(() => new Promise(() => undefined));
    const pending = prepareTerminalBaseContext("/repository", performance.now() + 200);
    await vi.advanceTimersByTimeAsync(201);
    const lines = await pending;
    expect(lines.join("\n")).toContain("publication.language=en");
    expect(lines.join("\n")).not.toContain("Applied owner rules:");
  });

  it("says when a read reached the deadline, and not when one only failed", async () => {
    vi.useFakeTimers();
    ports.instructions.mockImplementation(() => new Promise(() => undefined));
    const pending = prepareTerminalBaseParts("/repository", performance.now() + 200, 2048);
    await vi.advanceTimersByTimeAsync(201);
    expect((await pending).abandoned).toBe(true);
    ports.instructions.mockRejectedValue(new Error("unreadable rules"));
    expect(
      (await prepareTerminalBaseParts("/repository", performance.now() + 200, 2048)).abandoned,
    ).toBe(false);
  });
});
