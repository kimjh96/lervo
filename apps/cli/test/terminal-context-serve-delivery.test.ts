import { expect, it, vi } from "vitest";

// The stand-in hook reads its stage observation's delivery before and after it answers early.
const seen = vi.hoisted(() => ({ before: undefined as unknown, after: undefined as unknown }));
vi.mock("../src/terminal-hook-command.js", () => ({
  runTerminalHookCommand: vi.fn(
    async (
      _args: string[],
      io: { answer?: (stdout: string) => void },
      services: {
        createTerminalStageObservation: (digest: string) => { delivery?: () => unknown };
      },
    ) => {
      const port = services.createTerminalStageObservation(`sha256:${"a".repeat(64)}`);
      seen.before = port.delivery?.();
      io.answer?.("{}\n");
      seen.after = port.delivery?.();
      return 0;
    },
  ),
}));

const { runServedTerminalHook } = await import("../src/terminal-context-serve.js");

it("names the served answer's time from the client's start once it answered (schema 13)", async () => {
  const answer = await runServedTerminalHook({
    version: 1,
    kind: "prompt",
    runtime: `sha256:${"a".repeat(64)}`,
    cwd: "/tmp",
    args: ["--provider", "claude", "--contract", "2"],
    environment: {} as never,
    elapsed: 40,
    input: '{"hook_event_name":"UserPromptSubmit"}',
  });
  expect(await answer.drain?.()).toBe(true);
  expect(seen.before).toEqual({ channel: "context_server" });
  const after = seen.after as { channel: string; answerMilliseconds: number };
  expect(after.channel).toBe("context_server");
  // The client's 40 ms before the request count; the server's own part is small.
  expect(after.answerMilliseconds).toBeGreaterThanOrEqual(40);
  expect(after.answerMilliseconds).toBeLessThan(5000);
});
