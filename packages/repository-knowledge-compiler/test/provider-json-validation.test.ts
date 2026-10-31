import { afterEach, expect, it, vi } from "vitest";
import { createNoCapabilityProviderJsonRunner } from "../src/index.js";
import * as processHost from "../src/process-host.js";

afterEach(() => vi.restoreAllMocks());

it.each(["codex", "claude"] as const)(
  "reports invalid %s native envelope shapes as compiler failures",
  async (provider) => {
    vi.spyOn(processHost, "runProcess").mockImplementation(async (request) => ({
      status: "completed",
      exitCode: 0,
      stderr: "",
      stdout:
        request.arguments[0] === "--version"
          ? "1.2.3"
          : request.arguments[0] === "debug"
            ? '[{"type":"message"}]'
            : "null",
    }));
    const runner = await createNoCapabilityProviderJsonRunner({ provider });
    await expect(
      runner.resolveObserved?.({ responseContract: { schema: { type: "object" } } }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });
  },
);

it("treats invalid native Codex usage as unavailable rather than throwing a type error", async () => {
  vi.spyOn(processHost, "runProcess").mockImplementation(async (request) => ({
    status: "completed",
    exitCode: 0,
    stderr: "",
    stdout:
      request.arguments[0] === "--version"
        ? "1.2.3"
        : request.arguments[0] === "debug"
          ? '[{"type":"message"}]'
          : '{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}\n{"type":"turn.completed","usage":null}',
  }));
  const runner = await createNoCapabilityProviderJsonRunner({ provider: "codex" });
  await expect(
    runner.resolveObserved?.({ responseContract: { schema: { type: "object" } } }),
  ).resolves.toMatchObject({ usage: null });
});
