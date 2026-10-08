import { afterEach, expect, it, vi } from "vitest";

import { runKnowledgeConvergenceCommand } from "../src/knowledge-convergence-command.js";

const ports = vi.hoisted(() => ({
  open: vi.fn(),
  inspect: vi.fn(),
  read: vi.fn(),
  manifest: vi.fn(),
}));
vi.mock("@lervo/project-storage", () => ({ openReadOnlyProjectStorage: ports.open }));
vi.mock("@lervo/project", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  loadProjectManifest: ports.manifest,
}));
vi.mock("@lervo/repository-knowledge-runtime", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  inspectAutonomousKnowledgeStatus: ports.inspect,
  readAutonomousKnowledgeStatus: ports.read,
}));
afterEach(() => vi.resetAllMocks());

it("closes inspection storage and reports the typed source stop without private error details", async () => {
  const close = vi.fn().mockResolvedValue(undefined);
  ports.open.mockResolvedValue({ close });
  ports.inspect.mockRejectedValue(
    Object.assign(new Error("Private source /home/user/project and native diagnostic"), {
      code: "knowledge_source_kind_unsupported",
    }),
  );
  const stderr: string[] = [];
  const stdout: string[] = [];
  expect(
    await runKnowledgeConvergenceCommand(["inspect", "--json"], {
      cwd: "/fixture",
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    }),
  ).toBe(1);
  expect(close).toHaveBeenCalledOnce();
  expect(stdout).toEqual([]);
  expect(stderr).toEqual(["knowledge_source_kind_unsupported\n"]);
});

it.each([new Error("Private open failure"), { code: "/private/source", message: "secret" }])(
  "normalizes an untyped or unsafe storage-open failure without claiming currency",
  async (error) => {
    ports.open.mockRejectedValue(error);
    const stderr: string[] = [];
    expect(
      await runKnowledgeConvergenceCommand(["inspect", "--json"], {
        cwd: "/fixture",
        stdout: () => {
          throw new Error("Failed inspection must not emit successful status");
        },
        stderr: (value) => stderr.push(value),
      }),
    ).toBe(1);
    expect(ports.inspect).not.toHaveBeenCalled();
    expect(stderr).toEqual(["knowledge_inspection_failed\n"]);
  },
);

it("serves metadata status without opening canonical event storage or calling authoritative inspection", async () => {
  ports.manifest.mockResolvedValue({ projectId: "prj_fast" });
  const observed = {
    baselineCurrent: false,
    outstanding: null,
    observation: { coverage: "unknown" },
  };
  ports.read.mockResolvedValue(observed);
  const output: string[] = [];
  expect(
    await runKnowledgeConvergenceCommand(["status", "--json"], {
      cwd: "/fixture",
      stdout: (value) => output.push(value),
      stderr: () => {
        throw new Error("Unexpected error");
      },
    }),
  ).toBe(0);
  expect(JSON.parse(output[0]!)).toEqual(observed);
  expect(ports.read).toHaveBeenCalledOnce();
  expect(ports.open).not.toHaveBeenCalled();
  expect(ports.inspect).not.toHaveBeenCalled();
});
