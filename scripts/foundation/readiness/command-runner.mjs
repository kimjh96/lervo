import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function runFoundationCommand(input) {
  const startedAt = process.hrtime.bigint();
  try {
    const result = await execute(input.command, input.args, {
      cwd: input.repositoryRoot,
      env: { ...process.env, CI: "1" },
      timeout: input.timeoutMs ?? 10 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    return {
      checkId: input.checkId,
      status: "passed",
      durationMs: Number(durationMs.toFixed(3)),
      outputHash: `sha256:${createHash("sha256")
        .update(result.stdout)
        .update("\0")
        .update(result.stderr)
        .digest("hex")}`,
    };
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const detail = `${stdout}\n${stderr}`.trim().slice(-4000);
    throw new Error(`${input.checkId} failed${detail ? `:\n${detail}` : "."}`, { cause: error });
  }
}
