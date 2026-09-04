import { parseArgs } from "node:util";

import type {
  DocumentNormalizationResourceCeilings,
  DocumentNormalizationScope,
} from "@lervo/repository-knowledge";

export const documentNormalizationUsage =
  "lervo knowledge normalize (--provider <codex|claude>|--candidate <candidate-id>) [--scope <stale|all-pending>] [--source <relative-markdown-path>] [--source ...] [--preflight] [--max-source-bytes <bytes>] [--max-provider-calls <count>] [--max-observed-tokens <tokens>] [--max-elapsed-ms <ms>] [--root <path>] [--model <model>] [--executable <path>] [--timeout-ms <ms>] [--apply <plan-id> --approve-item <operation-id>=<approval-hash>] [--json]";

export interface DocumentNormalizationCommandOptions {
  help: boolean;
  root?: string;
  provider?: "codex" | "claude";
  candidate?: string;
  scope: DocumentNormalizationScope;
  sourcePaths?: string[];
  preflight: boolean;
  ceilings: Partial<DocumentNormalizationResourceCeilings>;
  model?: string;
  executable?: string;
  timeoutMs?: number;
  apply?: string;
  approveItems?: string[];
  json: boolean;
}

function positiveIntegerOption(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${option} must be a positive integer.`);
  return parsed;
}

export function parseDocumentNormalizationOptions(
  args: string[],
): DocumentNormalizationCommandOptions {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" },
      provider: { type: "string" },
      candidate: { type: "string" },
      scope: { type: "string" },
      source: { type: "string", multiple: true },
      preflight: { type: "boolean" },
      "max-source-bytes": { type: "string" },
      "max-provider-calls": { type: "string" },
      "max-observed-tokens": { type: "string" },
      "max-elapsed-ms": { type: "string" },
      model: { type: "string" },
      executable: { type: "string" },
      "timeout-ms": { type: "string" },
      apply: { type: "string" },
      "approve-item": { type: "string", multiple: true },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (parsed.values.help)
    return { help: true, scope: "all_pending", preflight: false, ceilings: {}, json: false };
  if ((parsed.values.provider === undefined) === (parsed.values.candidate === undefined))
    throw new Error("Specify exactly one of --provider or --candidate.");
  if (
    parsed.values.provider !== undefined &&
    parsed.values.provider !== "codex" &&
    parsed.values.provider !== "claude"
  )
    throw new Error("--provider must be codex or claude.");
  if (
    parsed.values.scope !== undefined &&
    parsed.values.scope !== "stale" &&
    parsed.values.scope !== "all-pending"
  )
    throw new Error("--scope must be stale or all-pending.");
  if (
    (parsed.values.scope !== undefined ||
      parsed.values.source !== undefined ||
      parsed.values.preflight ||
      parsed.values["max-source-bytes"] !== undefined ||
      parsed.values["max-provider-calls"] !== undefined ||
      parsed.values["max-observed-tokens"] !== undefined ||
      parsed.values["max-elapsed-ms"] !== undefined) &&
    parsed.values.provider === undefined
  )
    throw new Error("--scope, --source, --preflight, and resource ceilings require --provider.");
  if (
    parsed.values.preflight &&
    (parsed.values.apply !== undefined || (parsed.values["approve-item"]?.length ?? 0) > 0)
  )
    throw new Error("--preflight cannot be combined with apply or approval options.");
  if (parsed.values.apply !== undefined && parsed.values.candidate === undefined)
    throw new Error(
      "Applying normalization requires the stored --candidate ID shown by the planning command.",
    );
  const timeoutMs = positiveIntegerOption(parsed.values["timeout-ms"], "--timeout-ms");
  if (timeoutMs !== undefined && (timeoutMs < 1_000 || timeoutMs > 600_000))
    throw new Error("--timeout-ms must be an integer between 1000 and 600000.");
  const maximumSourceBytes = positiveIntegerOption(
    parsed.values["max-source-bytes"],
    "--max-source-bytes",
  );
  const maximumProviderCalls = positiveIntegerOption(
    parsed.values["max-provider-calls"],
    "--max-provider-calls",
  );
  const maximumObservedTokens = positiveIntegerOption(
    parsed.values["max-observed-tokens"],
    "--max-observed-tokens",
  );
  const maximumElapsedMilliseconds = positiveIntegerOption(
    parsed.values["max-elapsed-ms"],
    "--max-elapsed-ms",
  );
  return {
    help: false,
    ...(parsed.values.root === undefined ? {} : { root: parsed.values.root }),
    ...(parsed.values.provider === undefined
      ? {}
      : { provider: parsed.values.provider as "codex" | "claude" }),
    ...(parsed.values.candidate === undefined ? {} : { candidate: parsed.values.candidate }),
    scope: parsed.values.scope === "stale" ? "stale" : "all_pending",
    ...(parsed.values.source === undefined ? {} : { sourcePaths: parsed.values.source }),
    preflight: parsed.values.preflight ?? false,
    ceilings: {
      ...(maximumSourceBytes === undefined ? {} : { maximumSourceBytes }),
      ...(maximumProviderCalls === undefined ? {} : { maximumProviderCalls }),
      ...(maximumObservedTokens === undefined ? {} : { maximumObservedTokens }),
      ...(maximumElapsedMilliseconds === undefined ? {} : { maximumElapsedMilliseconds }),
    },
    ...(parsed.values.model === undefined ? {} : { model: parsed.values.model }),
    ...(parsed.values.executable === undefined ? {} : { executable: parsed.values.executable }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(parsed.values.apply === undefined ? {} : { apply: parsed.values.apply }),
    ...(parsed.values["approve-item"] === undefined
      ? {}
      : { approveItems: parsed.values["approve-item"] }),
    json: parsed.values.json ?? false,
  };
}
