import { watchProjectEventChanges, type ProjectStorage } from "@lervo/project-storage";
import { runAutonomousKnowledgeWorker } from "./worker.js";
import { recordKnowledgeResidentHealth, type KnowledgeResidentState } from "./resident-health.js";

/** The standalone host needs no Hub. Startup, event wakeups and a sixty-second timer share one owner. */
export function startAutonomousKnowledgeWorker(input: {
  storage: ProjectStorage;
  signal?: AbortSignal;
  workerId: string;
  provider: "codex" | "claude";
  executable?: string;
  admissionDirectory?: string;
  subscribe?: (notify: () => void) => () => void;
  onCycle?: (result: Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>>) => void;
  onFailure: (error: unknown) => void;
  intervalMilliseconds?: number;
}): () => Promise<void> {
  const interval = input.intervalMilliseconds ?? 60_000;
  if (!Number.isSafeInteger(interval) || interval < 100 || interval > 60_000)
    throw new Error("Invalid convergence interval.");
  const controller = new AbortController();
  let running: Promise<void> | null = null;
  let pending = false;
  let firstWake: number | null = null;
  let lastWake: number | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let healthState: KnowledgeResidentState = "idle";
  let healthReason: string | null = null;
  let healthWrite = Promise.resolve();
  const heartbeat = () => {
    healthWrite = healthWrite
      .then(() =>
        recordKnowledgeResidentHealth({
          repositoryRoot: input.storage.paths.repositoryRoot,
          workerId: input.workerId,
          state: healthState,
          reason: healthReason,
        }),
      )
      .catch(input.onFailure);
  };
  const cycle = () => {
    if (controller.signal.aborted || input.signal?.aborted) return;
    if (running !== null) {
      pending = true;
      return;
    }
    healthState = "running";
    healthReason = null;
    heartbeat();
    running = runAutonomousKnowledgeWorker({
      ...input,
      signal:
        input.signal === undefined
          ? controller.signal
          : AbortSignal.any([input.signal, controller.signal]),
    })
      .then((result) => {
        healthState =
          result.status === "busy"
            ? "busy"
            : result.convergence.state === "idle"
              ? "idle"
              : result.convergence.state === "waiting_authority"
                ? "waiting"
                : ["attention_required", "recovery_required"].includes(result.convergence.state)
                  ? "attention"
                  : "idle";
        healthReason = result.status === "processed" ? result.convergence.reason : null;
        heartbeat();
        input.onCycle?.(result);
      })
      .catch((error) => {
        healthState = "attention";
        healthReason = "knowledge_resident_cycle_failed";
        heartbeat();
        if (!controller.signal.aborted) input.onFailure(error);
      })
      .finally(() => {
        running = null;
        if (pending) {
          pending = false;
          schedule();
        }
      });
  };
  const schedule = () => {
    const now = Date.now();
    firstWake ??= now;
    lastWake = now;
    if (debounce !== null) clearTimeout(debounce);
    const delay = Math.max(0, Math.min(lastWake + 30_000, firstWake + 60_000) - now);
    debounce = setTimeout(() => {
      debounce = null;
      firstWake = null;
      lastWake = null;
      cycle();
    }, delay);
  };
  const unsubscribe = input.subscribe
    ? input.subscribe(schedule)
    : watchProjectEventChanges(
        { path: input.storage.paths.eventDatabase, latest: () => input.storage.events.latest() },
        schedule,
      );
  const timer = setInterval(cycle, interval);
  const healthTimer = setInterval(heartbeat, 15_000);
  cycle();
  return async () => {
    controller.abort();
    clearInterval(timer);
    clearInterval(healthTimer);
    if (debounce !== null) clearTimeout(debounce);
    unsubscribe?.();
    await running;
    healthState = "stopped";
    heartbeat();
    await healthWrite;
  };
}
