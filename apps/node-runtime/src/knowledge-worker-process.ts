import { fork, type ChildProcess } from "node:child_process";

interface KnowledgeWorkerProcessInput {
  entry: string;
  repositoryRoot: string;
  provider: "codex" | "claude";
  executable?: string;
  signal?: AbortSignal;
  onFailure(error: unknown): void;
}

/** Owns one resident child; stopping waits for its ordinary lease and provider cleanup. */
export function startKnowledgeWorkerProcess(
  input: KnowledgeWorkerProcessInput,
  launch: typeof fork = fork,
): () => Promise<void> {
  let stopping = input.signal?.aborted === true;
  let child: ChildProcess | undefined;
  let closed: Promise<void> = Promise.resolve();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopPromise: Promise<void> | undefined;
  const fail = (code: string) => input.onFailure(Object.assign(new Error(code), { code }));
  const start = () => {
    if (stopping) return;
    const args = [
      "knowledge-worker",
      "--root",
      input.repositoryRoot,
      "--provider",
      input.provider,
      "--owner",
      String(process.pid),
      ...(input.executable === undefined ? [] : ["--executable", input.executable]),
    ];
    try {
      child = launch(input.entry, args, {
        execPath: process.execPath,
        execArgv: [],
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      });
    } catch {
      fail("knowledge_worker_launch_failed");
      retry = setTimeout(start, 60_000);
      return;
    }
    const launched = child;
    closed = new Promise<void>((resolveClosed) => {
      launched.once("error", () => fail("knowledge_worker_launch_failed"));
      launched.once("close", () => {
        child = undefined;
        resolveClosed();
        if (!stopping) {
          fail("knowledge_worker_process_exited");
          retry = setTimeout(start, 60_000);
        }
      });
    });
  };
  const stopOnce = async () => {
    stopping = true;
    input.signal?.removeEventListener("abort", abort);
    if (retry !== undefined) clearTimeout(retry);
    const running = child;
    if (running !== undefined) {
      try {
        if (running.connected)
          running.send({ type: "knowledge_worker_stop" }, (error) => {
            if (error !== null && child === running) running.kill("SIGTERM");
          });
        else running.kill("SIGTERM");
      } catch {
        running.kill("SIGTERM");
      }
    }
    await closed;
  };
  const stop = () => (stopPromise ??= stopOnce());
  const abort = () => void stop().catch(input.onFailure);
  input.signal?.addEventListener("abort", abort, { once: true });
  start();
  return stop;
}
