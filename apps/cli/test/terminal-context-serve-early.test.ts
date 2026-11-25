import { expect, it, vi } from "vitest";

// The stand-in hook answers once its context is prepared, then records: it waits for the test to
// release it and asks for a detached launch meanwhile, as a prompt's settlement launch does.
const gate = vi.hoisted(() => {
  let release!: () => void;
  const released = new Promise<void>((done) => (release = done));
  return { released, release, launched: [] as boolean[], root: "", entry: "", marker: "" };
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
      gate.launched.push(
        await launchDetachedKnowledgeWorker({
          root: gate.root,
          entry: gate.entry,
          args: [gate.marker],
        }),
      );
      return 0;
    },
  ),
}));

const { runServedTerminalHook } = await import("../src/terminal-context-serve.js");
const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { resolve } = await import("node:path");

it("answers once the context is prepared and stays busy until the records finish (ADR-0636)", async () => {
  gate.root = await mkdtemp(resolve(tmpdir(), "lvearly-"));
  gate.entry = resolve(gate.root, "worker.mjs");
  gate.marker = resolve(gate.root, "started");
  // A launch that really starts writes its marker; one handed to an absent client never would.
  await writeFile(
    gate.entry,
    'import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[2], "started");\n',
  );
  const answer = await runServedTerminalHook({
    version: 1,
    kind: "prompt",
    runtime: `sha256:${"a".repeat(64)}`,
    cwd: "/tmp",
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
  expect(gate.launched).toEqual([true]);
  expect(answer.launches).toEqual([]);
  let started: string | null = null;
  for (let attempt = 0; attempt < 100 && started === null; attempt++) {
    started = await readFile(gate.marker, "utf8").catch(() => null);
    if (started === null) await new Promise((done) => setTimeout(done, 20));
  }
  expect(started).toBe("started");
  await rm(gate.root, { recursive: true, force: true });
});
