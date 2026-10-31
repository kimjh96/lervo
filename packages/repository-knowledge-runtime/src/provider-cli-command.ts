import { spawn } from "node:child_process";
import { providerCliDispatchContext } from "@lervo/repository-knowledge-compiler";

export interface ProviderCliCommandResult {
  status: "completed" | "failed" | "timed_out";
  stdout: string;
}

/** Login-shell and version observations have bounded time, output and process-tree lifetime. */
export function runProviderCliCommand(
  executable: string,
  args: string[],
  timeoutMs: number,
  environment?: NodeJS.ProcessEnv,
): Promise<ProviderCliCommandResult> {
  const context = providerCliDispatchContext(environment);
  return new Promise((finish) => {
    const child = spawn(executable, args, {
      shell: false,
      cwd: context.cwd,
      env: context.environment,
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    let forced: ProviderCliCommandResult["status"] | null = null;
    const kill = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      forced = "timed_out";
      kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stdout) + chunk.byteLength > 16 * 1024) {
        forced = "failed";
        kill();
      } else stdout += chunk.toString("utf8");
    });
    child.once("error", () => {
      forced = "failed";
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      finish({ status: forced ?? (code === 0 ? "completed" : "failed"), stdout });
    });
  });
}
