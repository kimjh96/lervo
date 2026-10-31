import { basename, relative } from "node:path";
import {
  canonicalJson,
  practicePublicPath,
  sanitizePracticeText,
  sha256,
} from "@lervo/repository-knowledge";
import { boundedUtf8Tail } from "./instruction-capture-queue.js";
import type { PracticeStep } from "./practice-state.js";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function executable(command: unknown): string | null {
  if (typeof command !== "string") return null;
  const normalized = command.replace(/^\s*nice\s+(?:-n\s+\d+\s+)?/u, "");
  // No shell expansion or argument text is retained. Compound commands remain separate tool steps.
  const first = normalized
    .trim()
    .match(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:[^\s]+)\s+)*([\w./-]+)/u)?.[1];
  return first ? basename(first).slice(0, 80) : null;
}

function verificationCommand(command: unknown): boolean {
  if (
    typeof command !== "string" ||
    /[;&|`$<>\n]/u.test(command) ||
    /(?:^|\s)--?(?:help|version)(?:\s|$)/u.test(command)
  )
    return false;
  const words = command
    .replace(/^\s*nice\s+(?:-n\s+\d+\s+)?/u, "")
    .trim()
    .split(/\s+/u);
  const name = executable(command);
  if (["tsc", "pytest", "vitest", "jest", "eslint"].includes(name ?? "")) return true;
  if (!["pnpm", "npm", "yarn", "bun", "cargo", "go", "deno", "make"].includes(name ?? ""))
    return false;
  const operation = words[1] === "run" ? words[2] : words[1];
  return (
    typeof operation === "string" &&
    /^(?:test|check|typecheck|lint|build|[a-z0-9_.:-]+:(?:check|test))$/u.test(operation)
  );
}

function repositoryPaths(input: Record<string, unknown>, root: string): string[] {
  return [
    ...new Set(
      [input.file_path, input.path, input.workdir]
        .filter((v): v is string => typeof v === "string")
        .map((path) => (path.startsWith("/") ? relative(root, path) : path))
        .filter(practicePublicPath),
    ),
  ].slice(0, 16);
}

function resultOutcome(result: Record<string, unknown>): PracticeStep["outcome"] {
  if (result.is_error === true) return "failed";
  if (result.is_error === false) return "passed";
  const output = result.output ?? result.content;
  const structured = object(
    typeof output === "string"
      ? (() => {
          try {
            return JSON.parse(output);
          } catch {
            return null;
          }
        })()
      : output,
  );
  const code =
    result.exit_code ??
    result.exitCode ??
    structured.exit_code ??
    structured.exitCode ??
    (typeof output === "string"
      ? /(?:Process exited with code|Exit code:)\s*(-?\d+)/u.exec(output)?.[1]
      : undefined);
  return code === undefined ? "unknown" : Number(code) === 0 ? "passed" : "failed";
}

/** Translate native tool records only; neither replies nor shell arguments prove success. */
export function extractPracticeSteps(
  entries: Record<string, unknown>[],
  root: string,
): {
  steps: PracticeStep[];
  reply: string;
  entryIds: string[];
  complete: boolean;
} {
  const steps: PracticeStep[] = [];
  const byId = new Map<string, PracticeStep>();
  const entryIds: string[] = [];
  let reply = "";
  for (const [index, entry] of entries.entries()) {
    const id = typeof entry.uuid === "string" ? entry.uuid : sha256(canonicalJson([index, entry]));
    entryIds.push(id);
    const payload = object(entry.payload);
    const message = object(entry.message);
    const content = message.content ?? payload.content;
    const blocks = Array.isArray(content) ? content.map(object) : [];
    if ((entry.type === "assistant" || payload.role === "assistant") && blocks.length)
      reply =
        blocks
          .filter((b) => b.type === "text" || b.type === "output_text")
          .map((b) => String(b.text ?? ""))
          .join("\n") || reply;
    if (entry.type === "assistant" && typeof content === "string") reply = content;
    const calls = [
      ...blocks.filter((b) => b.type === "tool_use"),
      ...(payload.type === "function_call" ? [payload] : []),
    ];
    for (const call of calls) {
      let input = object(call.input);
      if (typeof call.arguments === "string") {
        try {
          input = object(JSON.parse(call.arguments));
        } catch {
          /* Unknown arguments carry no evidence. */
        }
      }
      const command = input.command ?? input.cmd;
      const kind =
        typeof call.name === "string"
          ? call.name.replace(/[^A-Za-z0-9_.-]/gu, "").slice(0, 80)
          : "unknown";
      const step: PracticeStep = {
        entryId: sha256(`${id}\0${String(call.id ?? call.call_id ?? steps.length)}`),
        kind,
        executable: executable(command),
        paths: repositoryPaths(input, root),
        outcome: "unknown",
        verification: verificationCommand(command),
      };
      steps.push(step);
      byId.set(String(call.id ?? call.call_id), step);
    }
    for (const result of [
      ...blocks.filter((b) => b.type === "tool_result"),
      ...(payload.type === "function_call_output" ? [payload] : []),
    ]) {
      const step = byId.get(String(result.tool_use_id ?? result.call_id));
      if (step) step.outcome = resultOutcome({ ...object(entry.toolUseResult), ...result });
    }
  }
  return {
    steps: steps.slice(0, 128),
    reply: boundedUtf8Tail(sanitizePracticeText(reply), 16 * 1024),
    entryIds,
    complete: steps.length <= 128,
  };
}
