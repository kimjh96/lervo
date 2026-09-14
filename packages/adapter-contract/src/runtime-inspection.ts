import { spawn } from "node:child_process";
import { createProviderProcessEnvironment } from "./provider-process-environment.js";

export type ProviderRuntimeInspectionStatus = "available" | "unavailable" | "unknown";

export interface RuntimeExecutableInspection {
  status: ProviderRuntimeInspectionStatus;
  source: "path" | "bundled" | "configured";
  version: string | null;
  reasonCode:
    | "ready"
    | "executable_not_found"
    | "executable_permission_denied"
    | "probe_failed"
    | "probe_timed_out"
    | "unsupported_platform";
}

/** Operating-system start failures that prove the executable never ran. */
export function executableStartReasonCode(
  code: string | undefined,
): "executable_not_found" | "executable_permission_denied" | "probe_failed" {
  return code === "ENOENT"
    ? "executable_not_found"
    : code === "EACCES" || code === "EPERM"
      ? "executable_permission_denied"
      : "probe_failed";
}

export interface InspectRuntimeExecutableInput {
  executable: string;
  arguments?: readonly string[];
  source: RuntimeExecutableInspection["source"];
  timeoutMs?: number;
}

export interface ProviderRuntimeInspection extends RuntimeExecutableInspection {
  provider: "codex" | "claude";
}

export interface InspectProviderExecutableInput extends InspectRuntimeExecutableInput {
  provider: ProviderRuntimeInspection["provider"];
}

export async function inspectProviderExecutable(
  input: InspectProviderExecutableInput,
): Promise<ProviderRuntimeInspection> {
  return { provider: input.provider, ...(await inspectRuntimeExecutable(input)) };
}

const MAX_VERSION_BYTES = 16 * 1024;

function cleanedVersion(value: string): string | null {
  const line = value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find(Boolean);
  if (line === undefined || line.length > 200 || /[^\x20-\x7e]/u.test(line)) return null;
  return line;
}

export async function inspectRuntimeExecutable(
  input: InspectRuntimeExecutableInput,
): Promise<RuntimeExecutableInspection> {
  const timeoutMs = input.timeoutMs ?? 5_000;
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    let outputBytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: RuntimeExecutableInspection) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(input.executable, [...(input.arguments ?? ["--version"])], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: createProviderProcessEnvironment({ PATH: process.env.PATH }),
    });
    const collect = (chunk: Buffer) => {
      const remaining = MAX_VERSION_BYTES - outputBytes;
      if (chunk.byteLength <= remaining) {
        output += chunk.toString("utf8");
        outputBytes += chunk.byteLength;
        return;
      }
      if (remaining > 0) output += chunk.subarray(0, remaining).toString("utf8");
      child.kill("SIGKILL");
      finish({
        status: "unknown",
        source: input.source,
        version: null,
        reasonCode: "probe_failed",
      });
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error: NodeJS.ErrnoException) => {
      const reasonCode = executableStartReasonCode(error.code);
      finish({
        status: reasonCode === "probe_failed" ? "unknown" : "unavailable",
        source: input.source,
        version: null,
        reasonCode,
      });
    });
    child.once("close", (code) => {
      const version = cleanedVersion(output);
      finish({
        status: code === 0 && version !== null ? "available" : "unknown",
        source: input.source,
        version: code === 0 ? version : null,
        reasonCode: code === 0 && version !== null ? "ready" : "probe_failed",
      });
    });
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        status: "unknown",
        source: input.source,
        version: null,
        reasonCode: "probe_timed_out",
      });
    }, timeoutMs);
  });
}
