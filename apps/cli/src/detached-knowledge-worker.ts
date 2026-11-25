import { spawn } from "node:child_process";

/** A detached process the hook asks for, as the context server hands it to the hook's client. */
export interface DetachedLaunch {
  entry: string;
  args: string[];
  cwd: string;
  /** Variables the child needs beyond the session's own environment. */
  env: Record<string, string>;
}

/** Takes a launch for the hook's client; false when it can no longer reach the client. */
type DetachedLaunchHandOff = (launch: DetachedLaunch) => boolean;

let handOff: DetachedLaunchHandOff | null = null;

/**
 * While set, launches are handed to `collect` instead of started here. The context server sets it
 * for each served hook, so the hook's client starts them in the provider's session: with the
 * session's Node, environment, and umask, and outside the service's process tree, which a service
 * manager stops with the service.
 */
export function handOffDetachedLaunches(collect: DetachedLaunchHandOff | null): void {
  handOff = collect;
}

/**
 * Acknowledges process creation, or its hand-off to the hook's client, not worker completion. A
 * failed launch leaves queued work for the resident or the next full CLI cycle.
 */
export async function launchDetachedKnowledgeWorker(input: {
  root: string;
  entry: string;
  args: readonly string[];
}): Promise<boolean> {
  if (handOff !== null) {
    const runtime = process.env.LERVO_TERMINAL_HOOK_RUNTIME;
    return handOff({
      entry: input.entry,
      args: [...input.args],
      cwd: input.root,
      env: runtime === undefined ? {} : { LERVO_TERMINAL_HOOK_RUNTIME: runtime },
    });
  }
  try {
    const child = spawn(process.execPath, [input.entry, ...input.args], {
      cwd: input.root,
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    return await new Promise<boolean>((resolve) => {
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    });
  } catch {
    return false;
  }
}
