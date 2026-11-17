import type { ProcessObservation } from "@lervo/node-work-admission";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { readRuntimeReferenceText } from "./node-runtime-reference-file.js";

/** A content-addressed runtime directory name inside the Node runtimes directory. */
export const RUNTIME_DIRECTORY_NAME = /^[a-f0-9]{16}$/u;
/** The most runtime directory entries an inspection reads before refusing the inventory. */
export const MAXIMUM_RUNTIME_DIRECTORY_ENTRIES = 4096;
/** A process birth identity: `proc_<scheme>:sha256:<hex>`, as `@lervo/node-work-admission` observes. */
export const PROCESS_BIRTH_IDENTITY = /^proc_[a-z0-9_]{1,64}:sha256:[a-f0-9]{64}$/u;

/**
 * Whether a live process is provably not the one that recorded `recorded`: both identities use
 * the same scheme and differ, so its pid was reused. Another scheme, such as one from a newer
 * observer, proves nothing.
 */
export function birthIdentityContradicts(observed: ProcessObservation, recorded: string): boolean {
  return (
    observed.status === "present" &&
    observed.identity.split(":", 1)[0] === recorded.split(":", 1)[0] &&
    observed.identity !== recorded
  );
}

/**
 * One `<runtime>/.processes/<pid>.json` record a running payload writes at startup
 * (`bindInstalledRuntimeProcess`). `processIdentity` is the unvalidated birth identity; records
 * from older payloads may lack it.
 */
export interface RuntimeProcessBinding {
  processId: number;
  processIdentity: unknown;
  runtimeDirectory: string;
}

/**
 * Validates one record's structure against its file name and directory; a malformed record
 * throws. The birth identity is judged separately, by `runtimeProcessBindingIdentity`.
 */
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
  return { processId, processIdentity: binding.processIdentity, runtimeDirectory };
}

/**
 * The record's birth identity, or undefined for a record that predates identities. A malformed
 * identity throws. Callers judge it only while the process is alive: a dead process's record
 * protects and proves nothing, so its contents must not fail an inspection.
 */
export function runtimeProcessBindingIdentity(binding: RuntimeProcessBinding): string | undefined {
  if (binding.processIdentity === undefined) return undefined;
  if (
    typeof binding.processIdentity !== "string" ||
    !PROCESS_BIRTH_IDENTITY.test(binding.processIdentity)
  )
    throw new Error("Invalid runtime process birth identity.");
  return binding.processIdentity;
}

function provenIdentity(binding: RuntimeProcessBinding): string | undefined {
  try {
    return runtimeProcessBindingIdentity(binding);
  } catch {
    return undefined;
  }
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
  if (entries.length > MAXIMUM_RUNTIME_DIRECTORY_ENTRIES) return null;
  const bound: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !RUNTIME_DIRECTORY_NAME.test(entry.name)) continue;
    const binding = await readBinding(root, entry.name, processId);
    if (binding !== null && provenIdentity(binding) === observed.identity) bound.push(entry.name);
  }
  return bound.length === 1 ? bound[0]! : null;
}
