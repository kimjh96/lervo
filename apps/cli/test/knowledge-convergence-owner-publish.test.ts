import { beforeEach, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({ publish: vi.fn(), request: vi.fn(), close: vi.fn() }));
vi.mock("../src/knowledge-convergence-ownership.js", async (original) => ({
  ...(await original<typeof import("../src/knowledge-convergence-ownership.js")>()),
  createKnowledgePublisher: () => ports.publish,
}));
vi.mock("@lervo/project-storage", async (original) => ({
  ...(await original<typeof import("@lervo/project-storage")>()),
  openProjectStorage: async () => ({ close: ports.close }),
}));
vi.mock("@lervo/repository-knowledge-runtime", async (original) => ({
  ...(await original<typeof import("@lervo/repository-knowledge-runtime")>()),
  requestKnowledgeResidentCycle: ports.request,
}));

import { runKnowledgeConvergenceCommand } from "../src/knowledge-convergence-command.js";

async function publish() {
  const stdout: string[] = [];
  const code = await runKnowledgeConvergenceCommand(["owner", "publish", "--json"], {
    cwd: "/fixture",
    stdout: (value) => stdout.push(value),
    stderr: () => undefined,
  });
  return { code, output: JSON.parse(stdout.join("")) as { status: string } };
}

beforeEach(() => {
  ports.publish.mockReset();
  ports.request.mockReset();
});

it("asks the resident to take over a publication left waiting (ADR-0606)", async () => {
  ports.publish.mockResolvedValue({
    status: "published",
    state: { status: "awaiting_checks", pullRequestNumber: 395 },
    retryAfterMs: 120_000,
  });
  expect(await publish()).toMatchObject({ code: 0, output: { status: "published" } });
  expect(ports.request).toHaveBeenCalledWith("/fixture");
});

it("asks nothing when the publication awaits nothing", async () => {
  ports.publish.mockResolvedValue({
    status: "published",
    state: { status: "merged" },
    retryAfterMs: null,
  });
  await publish();
  ports.publish.mockResolvedValue({ status: "unchanged" });
  await publish();
  expect(ports.request).not.toHaveBeenCalled();
});
