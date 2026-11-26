import { expect, it, vi } from "vitest";

// The stand-in hook answers early, then its records ask for a detached launch.
const seen = vi.hoisted(() => ({ launched: [] as boolean[] }));
vi.mock("../src/terminal-hook-command.js", () => ({
  runTerminalHookCommand: vi.fn(
    async (_args: string[], io: { answer?: (stdout: string) => void }) => {
      const { launchDetachedKnowledgeWorker } = await import("../src/detached-knowledge-worker.js");
      io.answer?.("{}\n");
      await new Promise((done) => setTimeout(done, 5));
      seen.launched.push(
        await launchDetachedKnowledgeWorker({
          root: "/repo",
          entry: "/cli/bin.js",
          args: ["knowledge"],
        }),
      );
      return 0;
    },
  ),
}));

const { runServedTerminalHook } = await import("../src/terminal-context-serve.js");

it("keeps the records' launches for a relaying client instead of starting them in the server", async () => {
  const answer = await runServedTerminalHook({
    version: 1,
    kind: "stop",
    runtime: `sha256:${"a".repeat(64)}`,
    cwd: "/repo",
    args: ["--provider", "claude", "--contract", "2"],
    environment: {} as never,
    elapsed: 1,
    input: '{"hook_event_name":"Stop"}',
    session: {
      PATH: process.env.PATH ?? null,
      XDG_RUNTIME_DIR: null,
      DBUS_SESSION_BUS_ADDRESS: null,
    },
    umask: process.umask(),
    relay: true,
  });
  expect(answer).toMatchObject({ stdout: "{}\n", pending: true });
  expect(await answer.drain!()).toBe(true);
  // Taken for the relay: `/repo` does not exist, so a launch started here would have failed.
  expect(seen.launched).toEqual([true]);
  expect(answer.laterLaunches!()).toEqual([
    { entry: "/cli/bin.js", args: ["knowledge"], cwd: "/repo", env: {} },
  ]);
});
