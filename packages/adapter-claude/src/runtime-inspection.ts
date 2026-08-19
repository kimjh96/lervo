import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import {
  inspectProviderExecutable,
  type ProviderRuntimeInspection,
} from "@lervo/adapter-contract";

function usesMusl(): boolean {
  const report = process.report?.getReport() as {
    header?: { glibcVersionRuntime?: string };
  } | undefined;
  return process.platform === "linux" && report?.header?.glibcVersionRuntime === undefined;
}

function nativePackageName(): string | null {
  if (process.platform === "darwin" && (process.arch === "arm64" || process.arch === "x64")) {
    return `@anthropic-ai/claude-agent-sdk-darwin-${process.arch}`;
  }
  if (process.platform === "linux" && (process.arch === "arm64" || process.arch === "x64")) {
    return `@anthropic-ai/claude-agent-sdk-linux-${process.arch}${usesMusl() ? "-musl" : ""}`;
  }
  if (process.platform === "win32" && (process.arch === "arm64" || process.arch === "x64")) {
    return `@anthropic-ai/claude-agent-sdk-win32-${process.arch}`;
  }
  return null;
}

function bundledClaudeExecutable(): string | null {
  const packageName = nativePackageName();
  if (packageName === null) return null;
  try {
    const requireFromSdk = createRequire(
      createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk"),
    );
    const packageJson = requireFromSdk.resolve(`${packageName}/package.json`);
    return resolve(dirname(packageJson), process.platform === "win32" ? "claude.exe" : "claude");
  } catch {
    return null;
  }
}

export async function inspectClaudeRuntime(
  executable?: string,
): Promise<ProviderRuntimeInspection> {
  const resolved = executable ?? bundledClaudeExecutable();
  if (resolved === null) {
    return {
      provider: "claude",
      status: "unknown",
      source: executable === undefined ? "bundled" : "configured",
      version: null,
      reasonCode: nativePackageName() === null
        ? "unsupported_platform"
        : "executable_not_found",
    };
  }
  return inspectProviderExecutable({
    provider: "claude",
    executable: resolved,
    source: executable === undefined ? "bundled" : "configured",
  });
}
