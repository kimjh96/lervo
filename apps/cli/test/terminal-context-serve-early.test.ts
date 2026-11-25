import { expect, it, vi } from "vitest";

// The stand-in hook answers once its context is prepared, then records: it waits for the test to
// release it and asks for a detached launch meanwhile, as a prompt's settlement launch does.
const gate = vi.hoisted(() => {
  let release!: () => void;
  const released = new Promise<void>((done) => (release = done));
  return { released, release, launched: [] as boolean[] };
});
vi.mock("../src/terminal-hook-command.js", () => ({
  runTerminalHookCommand: vi.fn(
    async (
      _args: string[],
      io: { answer?: (stdout: string) => void; stdout: (m: string) => void },
    ) => {
      const { launchDetachedKnowledgeWorker } = await import("../src/detached-knowledge-worker.js");
      io.answer?.('{"hookSpecificOutput":{"additionalContext":"prepared"}}\n');
      await gate.released;
      // `/work` does not exist, so a launch started here fails to spawn and reports false.
      gate.launched.push(
        await launchDetachedKnowledgeWorker({ root: "/work", entry: "/cli/bin.js", args: ["s"] }),
      );
      return 0;
    },
  ),
}));

const { runServedTerminalHook } = await import("../src/terminal-context-serve.js");

it("answers once the context is prepared and stays busy until the records finish (ADR-0636)", async () => {
  const answer = await runServedTerminalHook({
    version: 1,
    kind: "prompt",
    runtime: `sha256:${"a".repeat(64)}`,
    cwd: "/work",
    args: ["--provider", "claude", "--contract", "2"],
    environment: {} as never,
    elapsed: 2,
    input: '{"hook_event_name":"UserPromptSubmit"}',
    session: {
      PATH: process.env.PATH ?? null,
      XDG_RUNTIME_DIR: null,
      DBUS_SESSION_BUS_ADDRESS: null,
    },
    umask: process.umask(),
  });
  // The answer went out while the records still wait.
  expect(answer.stdout).toBe('{"hookSpecificOutput":{"additionalContext":"prepared"}}\n');
  expect(answer.exitCode).toBe(0);
  expect(gate.launched).toEqual([]);
  let drained: boolean | undefined;
  const draining = answer.drain!().then((value) => (drained = value));
  await new Promise((done) => setTimeout(done, 20));
  expect(drained).toBeUndefined();
  gate.release();
  expect(await draining).toBe(true);
  // A launch the records ask for starts in the server, not handed to a client already gone.
  expect(gate.launched).toEqual([false]);
  expect(answer.launches).toEqual([]);
});
