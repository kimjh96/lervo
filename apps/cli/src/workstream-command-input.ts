import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { WorkstreamChange } from "@lervo/repository-knowledge";

import type { CliIo } from "./types.js";

const MAXIMUM_INPUT_BYTES = 64 * 1024;

export type WorkstreamActor =
  { kind: "user"; provider: null } | { kind: "agent"; provider: "codex" | "claude" };

/** How a planned write proceeds: print the plan, apply an exact reviewed plan, or both at once. */
export type WorkstreamApplyMode =
  { kind: "plan_only" } | { kind: "apply"; planId: string } | { kind: "apply_now" };

export interface WorkstreamWriteOptions {
  root?: string;
  from?: string;
  stdin?: boolean;
  patch?: string;
  "stdin-patch"?: boolean;
  actor?: string;
  provider?: string;
  apply?: string;
  "apply-now"?: boolean;
  json?: boolean;
}

export const workstreamWriteOptionSpec = {
  root: { type: "string" },
  from: { type: "string" },
  stdin: { type: "boolean" },
  actor: { type: "string" },
  provider: { type: "string" },
  apply: { type: "string" },
  "apply-now": { type: "boolean" },
  json: { type: "boolean" },
} as const;

export function parseWorkstreamActor(values: WorkstreamWriteOptions): WorkstreamActor {
  if (values.actor !== undefined && values.actor !== "user" && values.actor !== "agent")
    throw new Error("--actor must be user or agent.");
  if (values.actor === "agent") {
    if (values.provider !== "codex" && values.provider !== "claude")
      throw new Error("--provider must be codex or claude when --actor agent is used.");
    return { kind: "agent", provider: values.provider };
  }
  if (values.provider !== undefined)
    throw new Error("--provider is only valid with --actor agent.");
  return { kind: "user", provider: null };
}

export function parseWorkstreamApplyMode(values: WorkstreamWriteOptions): WorkstreamApplyMode {
  if (values.apply !== undefined && values["apply-now"])
    throw new Error("Choose either --apply <plan-id> or --apply-now.");
  if (values.apply !== undefined) return { kind: "apply", planId: values.apply };
  return values["apply-now"] ? { kind: "apply_now" } : { kind: "plan_only" };
}

function parseJson(input: string): unknown {
  if (Buffer.byteLength(input) > MAXIMUM_INPUT_BYTES)
    throw new Error("The workstream input exceeds 64 KiB.");
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error("The workstream input must be valid JSON.", { cause: error });
  }
}

async function boundedFile(path: string): Promise<string> {
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content) > MAXIMUM_INPUT_BYTES)
    throw new Error("The workstream input exceeds 64 KiB.");
  return content;
}

async function standardInput(io: CliIo): Promise<string> {
  const input = await io.stdin?.();
  if (input === undefined) throw new Error("Workstream JSON input is unavailable.");
  return input;
}

/** Reads a start draft or full update snapshot from exactly one of --from or --stdin. */
export async function readWorkstreamDocument(
  values: WorkstreamWriteOptions,
  io: CliIo,
): Promise<unknown> {
  if ((values.from === undefined) === !values.stdin)
    throw new Error("Choose exactly one of --from or --stdin.");
  return parseJson(
    values.stdin ? await standardInput(io) : await boundedFile(resolve(io.cwd, values.from!)),
  );
}

/** Reads an update change from exactly one of --patch, --stdin-patch, --from, or --stdin. */
export async function readWorkstreamChange(
  values: WorkstreamWriteOptions,
  io: CliIo,
): Promise<WorkstreamChange> {
  const sources = [
    values.patch !== undefined,
    values["stdin-patch"] === true,
    values.from !== undefined,
    values.stdin === true,
  ].filter(Boolean).length;
  if (sources !== 1)
    throw new Error("Choose exactly one of --patch, --stdin-patch, --from, or --stdin.");
  if (values.patch !== undefined) return { kind: "patch", value: parseJson(values.patch) };
  if (values["stdin-patch"]) return { kind: "patch", value: parseJson(await standardInput(io)) };
  return { kind: "snapshot", value: await readWorkstreamDocument(values, io) };
}
