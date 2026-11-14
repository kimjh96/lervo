import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { relative, resolve } from "node:path";

import { openSqliteDatabase } from "@lervo/sqlite-connection";
import type { OutboxStore } from "@lervo/storage-contract";

import { captureConvergenceSources } from "../src/source-capture.js";

const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/**
 * Event types a stage may append between a decision check and the next exact fence, as the
 * source-fence census in `source-fences.md` argues: coordination and leases, spend accounting
 * and settled records that claim no currency. Every other type is a write that needs a fence.
 */
export const CENSUS_EXEMPT_EVENT_TYPES: ReadonlySet<string> = new Set([
  // Assignment coordination: leases scope work; every effect under them is fenced again.
  "assignment.created",
  "assignment.claimed",
  "assignment.completed",
  // Freshness is its own subsystem: it never uses the convergence session and fences itself.
  "document.freshness.cycle.completed",
]);

/** Files under `.lervo/state/` that hold no durable effect, with the census reason. */
const EXEMPT_STATE_PATHS: readonly RegExp[] = [
  // Databases are compared by their rows below, not their pages.
  /\.sqlite(-wal|-shm|-journal)?$/u,
  // Content-addressed artifacts grant nothing until an event or settled state names them.
  /^cas\//u,
  // The observation clock probe, rewritten at every session opening.
  /^knowledge\/observation-clock-probe$/u,
  // Resident bookkeeping and rebuildable projections outside any obligation: the worker lock,
  // maintenance, retention, freshness and staleness readings, and provider CLI detection.
  /^knowledge-worker\.lock$/u,
  /^knowledge\/(cas-retention-observation|maintenance-observation|maintenance-schedule|freshness-cycle|document-staleness|provider-clis|provider-cli-selection|requeue-cursor)\.json$/u,
  /^knowledge\/terminal-skills\/usage\.json$/u,
];

function walkFiles(root: string, directory: string, skip: (path: string) => boolean): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const name = relative(root, path);
    if (skip(name)) continue;
    if (entry.isDirectory()) files.push(...walkFiles(root, path, skip));
    else if (entry.isSymbolicLink()) files.push(`${name} -> ${readlinkSync(path)}`);
    else if (entry.isFile()) files.push(`${name}:${digest(readFileSync(path))}`);
  }
  return files.sort();
}

/** Each private convergence workspace: its HEAD and every file it holds. */
function workspaces(root: string): string[] {
  const base = resolve(root, ".lervo/state/knowledge/convergence-workspaces");
  const found: string[] = [];
  const visit = (directory: string) => {
    if (!existsSync(directory)) return;
    if (existsSync(resolve(directory, ".git")) && lstatSync(resolve(directory, ".git")).isFile()) {
      const head = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      found.push(
        `${relative(root, directory)} HEAD ${head}`,
        ...walkFiles(directory, directory, (name) => name === ".git"),
      );
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true }))
      if (entry.isDirectory()) visit(resolve(directory, entry.name));
  };
  visit(base);
  return found;
}

function checkpoints(root: string): string[] {
  const path = resolve(root, ".lervo/state/knowledge/convergence-effects.sqlite");
  if (!existsSync(path)) return [];
  const db = openSqliteDatabase(path, { busyTimeoutMs: 5_000 });
  try {
    return (
      db.prepare("SELECT coordinate_hash, effect, artifact_hash FROM checkpoints").all() as {
        coordinate_hash: string;
        effect: string | null;
        artifact_hash: string;
      }[]
    )
      .map((row) => `${row.effect}:${row.coordinate_hash}:${row.artifact_hash}`)
      .sort();
  } finally {
    db.close();
  }
}

/**
 * Everything a convergence effect can make durable, except the event store, which callers read
 * through `eventsAfter`: HEAD, every ref, every captured source but the edited one, private
 * knowledge state (candidate, disposition, classification and normalization stores among it),
 * effect checkpoints, and each private workspace's HEAD and files.
 */
export function durableEffectState(root: string, editedPath: string): Record<string, unknown> {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  return {
    head: git("rev-parse", "HEAD"),
    refs: git("for-each-ref", "--format=%(refname) %(objectname)"),
    sources: captureConvergenceSources(root, "effect-state")
      .sources.filter((source) => source.path !== editedPath)
      .map((source) => `${source.path}:${source.contentHash}`),
    state: walkFiles(
      resolve(root, ".lervo/state"),
      resolve(root, ".lervo/state"),
      (name) =>
        name.startsWith("knowledge/convergence-workspaces") ||
        EXEMPT_STATE_PATHS.some((pattern) => pattern.test(name)),
    ),
    checkpoints: checkpoints(root),
    workspaces: workspaces(root),
  };
}

/** Names the parts of two durable states that differ. */
export function durableStateChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const changes: string[] = [];
  for (const key of Object.keys(before)) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (Array.isArray(a) && Array.isArray(b)) {
      const added = b.filter((item) => !a.includes(item));
      const removed = a.filter((item) => !b.includes(item));
      // Retiring a private checkout carries no bytes anywhere.
      if (key === "workspaces" && added.length === 0) continue;
      changes.push(
        `${key}: +${JSON.stringify(added.slice(0, 3))} -${JSON.stringify(removed.slice(0, 3))}`,
      );
    } else changes.push(`${key}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
  return changes;
}

export function latestEventSeq(events: OutboxStore): number {
  return events.latest()?.seq ?? 0;
}

/** Event types appended after `seq` that the census does not exempt. */
export function unexemptEventsAfter(events: OutboxStore, seq: number): string[] {
  const types: string[] = [];
  for (let afterSeq = seq; ;) {
    const page = events.list({ afterSeq, limit: 1000 });
    for (const event of page) {
      if (CENSUS_EXEMPT_EVENT_TYPES.has(event.type)) continue;
      // A waiting, attention or stale stage record claims no currency; a current one is settled
      // behind the exact settlement fence and must never follow an unrefused edit.
      if (
        event.type === "repository.knowledge.stage.recorded" &&
        (event.payload as { state?: string }).state !== "current"
      )
        continue;
      types.push(`${event.type}${event.type.endsWith("stage.recorded") ? " (current)" : ""}`);
    }
    if (page.length < 1000) return types;
    afterSeq = page.at(-1)!.seq;
  }
}
