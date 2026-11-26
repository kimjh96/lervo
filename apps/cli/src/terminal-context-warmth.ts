// Keeps the checkouts the context server served recently warm. A prompt right after the server
// started, or after a long idle on a host that paged the server out, otherwise pays for cold code,
// cold caches, and memory read back from swap: on 2026-11-26 the Mac's first prompt after a
// restart took 9.8 s, and an idle server took up to 2.2 s to accept a request.
import { readFile, rename, writeFile } from "node:fs/promises";

import { resolveTerminalRoots } from "./terminal-roots.js";
import { prepareTerminalPromptContext } from "./terminal-prompt-context.js";
import { createTerminalStageObservation } from "./terminal-stage-observation.js";

/** The checkouts remembered across restarts, beside the socket. Paths only, owner-only. */
export const TERMINAL_CONTEXT_WARMTH_FILE = "context-warmth.json";
const REMEMBERED = 4;
/** How often an idle server warms its most recent checkout. */
const WARM_INTERVAL_MS = 60_000;
/** How long after its last request a checkout stays warm. */
const WARM_WINDOW_MS = 30 * 60_000;

export interface TerminalContextWarmth {
  /** Notes a served request's checkout. */
  served(cwd: string): void;
  /** Warms the remembered checkouts once, then keeps the latest warm while the server is idle. */
  start(): Promise<void>;
  stop(): void;
}

/** Prepares a prompt's context without recording anything, so its code and caches stay warm. */
async function warmCheckout(cwd: string): Promise<void> {
  const { evidenceRoot, executionRoot } = await resolveTerminalRoots(cwd);
  await prepareTerminalPromptContext({
    root: evidenceRoot,
    executionRoot,
    prompt: "",
    provider: "claude",
    observationId: "tobs_contextwarmth",
    workspaceBinding: null,
    timing: createTerminalStageObservation(`sha256:${"0".repeat(64)}`),
  });
}

export function terminalContextWarmth(input: {
  /** Whether a request holds the server; warming never starts while one does. */
  busy: () => boolean;
  warm?: (cwd: string) => Promise<void>;
  file?: string;
  now?: () => number;
  intervalMs?: number;
}): TerminalContextWarmth {
  const warm = input.warm ?? warmCheckout;
  const file = input.file ?? TERMINAL_CONTEXT_WARMTH_FILE;
  const now = input.now ?? Date.now;
  const recent = new Map<string, number>();
  let warming = false;
  let timer: NodeJS.Timeout | undefined;
  let persisting = Promise.resolve();
  const persist = () => {
    const bytes = `${JSON.stringify({ schemaVersion: 1, checkouts: [...recent.keys()] })}\n`;
    persisting = persisting
      .then(async () => {
        await writeFile(`${file}.${process.pid}.tmp`, bytes, { mode: 0o600 });
        await rename(`${file}.${process.pid}.tmp`, file);
      })
      .catch(() => undefined);
  };
  const warmOnce = async (cwd: string) => {
    if (warming || input.busy()) return;
    warming = true;
    try {
      await warm(cwd);
    } catch {
      // A checkout that cannot be prepared now is simply not warm; its next prompt says why.
    } finally {
      warming = false;
    }
  };
  const tick = async () => {
    for (const [cwd, at] of recent) if (now() - at > WARM_WINDOW_MS) recent.delete(cwd);
    const latest = [...recent.keys()].at(-1);
    if (latest !== undefined) await warmOnce(latest);
  };
  return {
    served(cwd) {
      recent.delete(cwd);
      recent.set(cwd, now());
      while (recent.size > REMEMBERED) recent.delete(recent.keys().next().value!);
      persist();
    },
    async start() {
      try {
        const value = JSON.parse(await readFile(file, "utf8")) as { checkouts?: unknown };
        if (Array.isArray(value.checkouts))
          for (const cwd of value.checkouts.slice(-REMEMBERED))
            if (typeof cwd === "string" && !recent.has(cwd)) recent.set(cwd, now());
      } catch {
        // Nothing remembered: the first request warms its own checkout.
      }
      for (const cwd of [...recent.keys()].reverse()) await warmOnce(cwd);
      timer = setInterval(() => void tick(), input.intervalMs ?? WARM_INTERVAL_MS);
      timer.unref();
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
    },
  };
}
