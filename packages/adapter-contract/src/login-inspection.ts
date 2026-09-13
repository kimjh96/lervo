import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { createProviderProcessEnvironment } from "./provider-process-environment.js";

export interface ProviderLoginContext {
  homeDirectory: string;
  configurationDirectory: string;
}

export interface ProviderLoginInspection {
  provider: "codex" | "claude";
  status: "login_present" | "login_absent" | "unobserved";
  reasonCode:
    | "native_login_present"
    | "native_login_absent"
    | "unrecognized_response"
    | "executable_not_found"
    | "probe_failed"
    | "probe_timed_out";
}

/** Deliberately excludes inherited API keys and other credential-bearing environment variables. */
export function providerLoginEnvironment(context: ProviderLoginContext): Record<string, string> {
  for (const path of [context.homeDirectory, context.configurationDirectory])
    if (typeof path !== "string" || path.length > 4096 || path.includes("\0") || !isAbsolute(path))
      throw new TypeError("The provider login context is invalid.");
  return createProviderProcessEnvironment({
    PATH: process.env.PATH,
    HOME: context.homeDirectory,
    USERPROFILE: context.homeDirectory,
  });
}

/** Raw responses remain in the adapter parser and never enter inspection results. */
export async function inspectProviderLoginProbe(input: {
  provider: ProviderLoginInspection["provider"];
  executable: string;
  arguments: readonly string[];
  workingDirectory: string;
  environment: Readonly<Record<string, string>>;
  parse(exitCode: number | null, stdout: string, stderr: string): ProviderLoginInspection["status"];
  timeoutMs?: number;
}): Promise<ProviderLoginInspection> {
  const timeoutMs = input.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new TypeError("The provider login probe timeout is invalid.");
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (
      status: ProviderLoginInspection["status"],
      reasonCode: ProviderLoginInspection["reasonCode"],
    ) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve({ provider: input.provider, status, reasonCode });
    };
    const child = spawn(input.executable, [...input.arguments], {
      cwd: input.workingDirectory,
      env: { ...input.environment },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.byteLength;
      if (bytes > 16 * 1024) {
        child.kill("SIGKILL");
        finish("unobserved", "probe_failed");
        return;
      }
      if (stream === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.once("error", (error: NodeJS.ErrnoException) =>
      finish(
        "unobserved",
        error.code === "ENOENT" || error.code === "EACCES"
          ? "executable_not_found"
          : "probe_failed",
      ),
    );
    child.once("close", (code) => {
      if (settled) return;
      let status: ProviderLoginInspection["status"] = "unobserved";
      try {
        const parsed = input.parse(code, stdout, stderr);
        if (["login_present", "login_absent", "unobserved"].includes(parsed)) status = parsed;
      } catch {
        /* Malformed native responses are unavailable evidence. */
      }
      finish(
        status,
        status === "login_present"
          ? "native_login_present"
          : status === "login_absent"
            ? "native_login_absent"
            : "unrecognized_response",
      );
    });
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish("unobserved", "probe_timed_out");
    }, timeoutMs);
  });
}
