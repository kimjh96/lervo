import { spawn, type ChildProcess } from "node:child_process";
import { delimiter, dirname } from "node:path";

import type {
  ConversationRequestedRuntimeProcess,
  ConversationRequestedRuntimeProcessPort,
  ConversationRequestedRuntimeTarget,
} from "./conversation-requested-runtime.js";

export function requestedRuntimeEnvironment(
  executable: string,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const pathKey = Object.keys(inherited).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const executableDirectory = dirname(executable);
  const inheritedPath = inherited[pathKey] ?? "";
  const entries = inheritedPath.split(delimiter).filter((entry) => entry.length > 0);
  return {
    ...inherited,
    [pathKey]: [
      executableDirectory,
      ...entries.filter((entry) => entry !== executableDirectory),
    ].join(delimiter),
  };
}

function processExit(child: ChildProcess) {
  return new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
    child.once("exit", (exitCode, signal) => resolve({ exitCode, signal }));
    child.once("error", () => resolve({ exitCode: null, signal: null }));
  });
}

async function stopChild(
  child: ChildProcess,
  exited: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  if (process.platform === "win32" && (child.exitCode !== null || child.signalCode !== null)) {
    return;
  }
  const signal = (name: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      process.kill(process.platform === "win32" ? child.pid : -child.pid, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  let timer!: ReturnType<typeof setTimeout>;
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<true>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
      timer.unref?.();
    }),
  ]);
  clearTimeout(timer);
  if (timedOut) signal("SIGKILL");
}

async function waitForHealth(input: {
  target: ConversationRequestedRuntimeTarget;
  exited: Promise<unknown>;
  fetch: typeof globalThis.fetch;
}): Promise<void> {
  if (input.target.healthUrl === undefined) return;
  const deadline = Date.now() + input.target.startupTimeoutMs;
  while (Date.now() < deadline) {
    const ready = await Promise.race([
      input.exited.then(() => "exited" as const),
      input
        .fetch(input.target.healthUrl, { signal: AbortSignal.timeout(1_000) })
        .then((response) => (response.ok ? ("ready" as const) : ("retry" as const)))
        .catch(() => "retry" as const),
    ]);
    if (ready === "ready") return;
    if (ready === "exited") throw new Error("The requested runtime exited before readiness.");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The requested runtime did not become ready before its startup deadline.");
}

export class NodeConversationRequestedRuntimeProcess implements ConversationRequestedRuntimeProcessPort {
  constructor(private readonly fetch: typeof globalThis.fetch = globalThis.fetch) {}

  async start(
    target: ConversationRequestedRuntimeTarget,
  ): Promise<ConversationRequestedRuntimeProcess> {
    const child = spawn(target.executable, target.arguments, {
      cwd: target.workingDirectory,
      env: requestedRuntimeEnvironment(target.executable),
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    const exited = processExit(child);
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      await waitForHealth({ target, exited, fetch: this.fetch });
    } catch (error) {
      await stopChild(child, exited, target.stopTimeoutMs).catch(() => undefined);
      throw error;
    }
    return {
      exited,
      stop: (timeoutMs) => stopChild(child, exited, timeoutMs),
    };
  }
}
