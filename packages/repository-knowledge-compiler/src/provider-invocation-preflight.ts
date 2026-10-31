import { providerCliDispatchContext } from "./provider-dispatch-context.js";
import { compileFailure } from "./compiler-failure.js";
import { runProcess } from "./process-host.js";
import {
  CODEX_NO_CAPABILITY_DISABLED_FEATURES,
  assertCodexHasNoModelTools,
} from "./codex-capability-probe.js";
import type { CreateProcessProviderOptions } from "./process-provider-contract.js";

async function compilerVersion(input: {
  executable: string;
  environment?: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs: number;
}): Promise<string> {
  const result = await runProcess({
    executable: input.executable,
    ...(input.environment === undefined ? {} : { environment: input.environment }),
    arguments: ["--version"],
    cwd: input.cwd,
    timeoutMs: Math.min(input.timeoutMs, 10_000),
    maxOutputBytes: 16 * 1024,
  });
  const version = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (
    result.status !== "completed" ||
    version === undefined ||
    version.length > 200 ||
    /[^\x20-\x7e]/u.test(version)
  ) {
    throw Object.assign(
      compileFailure("The provider compiler executable version could not be determined."),
      { processStatus: result.status },
    );
  }
  return version;
}

export async function prepareNoCapabilityInvocation(
  options: CreateProcessProviderOptions,
): Promise<{ executable: string; timeoutMs: number; version: string }> {
  await options.beforeCall?.();
  const executable = options.executable ?? options.provider;
  const timeoutMs = options.timeoutMs ?? 180_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000)
    throw compileFailure("The provider compiler timeout must be between 1 second and 10 minutes.");
  const invocation = {
    executable,
    ...providerCliDispatchContext(options.environment),
    timeoutMs,
  };
  const version = await compilerVersion(invocation);
  if (options.provider === "codex") await assertCodexHasNoModelTools(invocation);
  return { executable, timeoutMs, version };
}

export function providerInvocationContract(
  options: CreateProcessProviderOptions,
  version: string,
) {
  return {
    provider: options.provider,
    providerCliVersion: version,
    providerCliIdentityHash: options.identityHash ?? null,
    model: options.model ?? "provider-default",
    disabledCapabilities:
      options.provider === "codex"
        ? CODEX_NO_CAPABILITY_DISABLED_FEATURES
        : ["all-built-in-tools", "all-mcp", "all-customizations"],
  };
}
