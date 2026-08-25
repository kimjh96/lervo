import { spawn } from "node:child_process";

export type ProviderRuntimeInspectionStatus = "available" | "unavailable" | "unknown";

export interface ProviderRuntimeInspection {
  provider: "codex" | "claude";
  status: ProviderRuntimeInspectionStatus;
  source: "path" | "bundled" | "configured";
  version: string | null;
  reasonCode:
    "ready" | "executable_not_found" | "probe_failed" | "probe_timed_out" | "unsupported_platform";
}

export interface InspectProviderExecutableInput {
  provider: ProviderRuntimeInspection["provider"];
  executable: string;
  arguments?: readonly string[];
  source: ProviderRuntimeInspection["source"];
  timeoutMs?: number;
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

export async function inspectProviderExecutable(
  input: InspectProviderExecutableInput,
): Promise<ProviderRuntimeInspection> {
  const timeoutMs = input.timeoutMs ?? 5_000;
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    let outputBytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: ProviderRuntimeInspection) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(input.executable, [...(input.arguments ?? ["--version"])], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env.PATH === undefined ? {} : { PATH: process.env.PATH },
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
        provider: input.provider,
        status: "unknown",
        source: input.source,
        version: null,
        reasonCode: "probe_failed",
      });
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error: NodeJS.ErrnoException) =>
      finish({
        provider: input.provider,
        status: error.code === "ENOENT" || error.code === "EACCES" ? "unavailable" : "unknown",
        source: input.source,
        version: null,
        reasonCode:
          error.code === "ENOENT" || error.code === "EACCES"
            ? "executable_not_found"
            : "probe_failed",
      }),
    );
    child.once("close", (code) => {
      const version = cleanedVersion(output);
      finish({
        provider: input.provider,
        status: code === 0 && version !== null ? "available" : "unknown",
        source: input.source,
        version: code === 0 ? version : null,
        reasonCode: code === 0 && version !== null ? "ready" : "probe_failed",
      });
    });
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        provider: input.provider,
        status: "unknown",
        source: input.source,
        version: null,
        reasonCode: "probe_timed_out",
      });
    }, timeoutMs);
  });
}
