import type { ProcessObservation } from "@lervo/node-work-admission";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { readRuntimeReferenceText } from "./node-runtime-reference-file.js";

const RUNTIME_DIRECTORY = /^[a-f0-9]{16}$/u;
const PROCESS_IDENTITY = /^proc_[a-z0-9_]{1,64}:sha256:[a-f0-9]{64}$/u;
const MAXIMUM_RUNTIME_DIRECTORIES = 4096;

/**
 * One `<runtime>/.processes/<pid>.json` record a running payload writes at startup
 * (`bindInstalledRuntimeProcess`). `processIdentity` is the process's birth identity; records
 * from older payloads may lack it.
 */
export interface RuntimeProcessBinding {
  processId: number;
  processIdentity: string | undefined;
  runtimeDirectory: string;
}

/** Validates one binding record against its file name and directory; malformed records throw. */
export function parseRuntimeProcessBinding(
  text: string,
  runtimeDirectory: string,
  processId: number,
): RuntimeProcessBinding {
  const binding = JSON.parse(text) as {
    schemaVersion?: number;
    processId?: number;
    processIdentity?: unknown;
    runtimeDirectory?: string;
  } | null;
  if (
    !Number.isSafeInteger(processId) ||
    processId < 1 ||
    binding?.schemaVersion !== 1 ||
    binding.processId !== processId ||
    binding.runtimeDirectory !== runtimeDirectory
  )
    throw new Error("Invalid runtime process binding.");
  if (
    binding.processIdentity !== undefined &&
    (typeof binding.processIdentity !== "string" || !PROCESS_IDENTITY.test(binding.processIdentity))
  )
    throw new Error("Invalid runtime process birth identity.");
  return { processId, processIdentity: binding.processIdentity, runtimeDirectory };
}

async function readBinding(
  root: string,
  runtimeDirectory: string,
  processId: number,
): Promise<RuntimeProcessBinding | null> {
  try {
    const text = await readRuntimeReferenceText(
      resolve(root, runtimeDirectory, ".processes", `${processId}.json`),
    );
    return text === null ? null : parseRuntimeProcessBinding(text, runtimeDirectory, processId);
  } catch {
    // An unreadable or malformed record proves nothing; the caller treats it as unbound.
    return null;
  }
}

/**
 * ADR-0573: the one runtime directory a live process proved it loaded. Proof is a binding record
 * for that process id whose birth identity equals the process's observed one, so a reused id or
 * an unobservable process never counts. Returns null when there is no single such record.
 */
export async function findRuntimeProcessBinding(
  root: string,
  processId: number,
  observeProcess: (pid: number) => ProcessObservation,
): Promise<string | null> {
  const observed = observeProcess(processId);
  if (observed.status !== "present") return null;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  if (entries.length > MAXIMUM_RUNTIME_DIRECTORIES) return null;
  const bound: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !RUNTIME_DIRECTORY.test(entry.name)) continue;
    const binding = await readBinding(root, entry.name, processId);
    if (binding?.processIdentity === observed.identity) bound.push(entry.name);
  }
  return bound.length === 1 ? bound[0]! : null;
}
