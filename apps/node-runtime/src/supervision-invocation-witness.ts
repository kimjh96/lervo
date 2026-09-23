import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import type { UnitInvocationWitness } from "./supervision-unit-invocation-proof.js";

const INVOCATION_ID = /^[a-f0-9]{32}$/u;
const UNIT = /^[A-Za-z0-9@._-]{1,128}$/u;

function run(file: string, args: readonly string[]): string {
  return execFileSync(file, [...args], {
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

/** The invocation identifier of the unit instance running now; the caller rechecks it at commit. */
export function currentUnitInvocationId(unit: string): string {
  if (!UNIT.test(unit)) throw new Error("The witness unit name is invalid.");
  const id = run("systemctl", ["--user", "show", unit, "-p", "InvocationID", "--value"]).trim();
  if (!INVOCATION_ID.test(id)) throw new Error("The current unit invocation is unavailable.");
  return id;
}

/**
 * Read this unit's ordered invocation inventory from the local journal. A completed invocation
 * transition fences the process that owned an abandoned turn exactly as a reboot fences a host.
 */
export function observeAbandonedTurnWitness(input: {
  unit: string;
  incidentAt: string;
  observedAt: string;
}): UnitInvocationWitness {
  if (!UNIT.test(input.unit)) throw new Error("The witness unit name is invalid.");
  const inventory = run("journalctl", [
    "--user",
    "-u",
    input.unit,
    "-o",
    "json",
    "--output-fields=_SYSTEMD_INVOCATION_ID",
    "--no-pager",
  ]);
  const windows = new Map<string, { first: number; last: number }>();
  for (const line of inventory.split("\n")) {
    if (line.trim().length === 0) continue;
    const entry = JSON.parse(line) as Record<string, unknown>;
    const id = entry._SYSTEMD_INVOCATION_ID;
    const at = Number(entry.__REALTIME_TIMESTAMP) / 1000;
    if (typeof id !== "string" || !INVOCATION_ID.test(id) || !Number.isFinite(at)) continue;
    const window = windows.get(id) ?? { first: at, last: at };
    windows.set(id, { first: Math.min(window.first, at), last: Math.max(window.last, at) });
  }
  // A unit's invocations are sequential, so an invocation owns the quiet gap after its last log
  // line until the next invocation starts. Bounding by logged lines alone would leave a run that
  // happened during silence inside no window at all.
  const logged = [...windows.entries()]
    .map(([id, window]) => ({ id, ...window }))
    .sort((left, right) => left.first - right.first);
  const ordered = logged.map((window, index) => ({
    ...window,
    last: logged[index + 1] === undefined ? window.last : logged[index + 1]!.first,
  }));
  const incident = Date.parse(input.incidentAt);
  if (!Number.isFinite(incident)) throw new Error("The incident time is invalid.");
  const candidates = ordered.filter(
    (window) => window.first <= incident && incident <= window.last,
  );
  if (candidates.length !== 1)
    throw new Error("The incident has no unique observed unit invocation.");
  const index = ordered.indexOf(candidates[0]!);
  const successor = ordered[index + 1];
  const current = currentUnitInvocationId(input.unit);
  if (
    successor === undefined ||
    current === candidates[0]!.id ||
    ordered.at(-1)?.id !== current ||
    candidates[0]!.last > successor.first ||
    successor.first > Date.parse(input.observedAt)
  )
    throw new Error("The abandoned turn has no observed successor invocation fence.");
  return {
    schemaVersion: 1,
    kind: "host.unit_invocation_witness",
    unit: input.unit,
    incidentAt: input.incidentAt,
    incidentInvocationId: candidates[0]!.id,
    incidentInvocationFirstAt: new Date(candidates[0]!.first).toISOString(),
    incidentInvocationLastAt: new Date(candidates[0]!.last).toISOString(),
    successorInvocationId: successor.id,
    successorInvocationFirstAt: new Date(successor.first).toISOString(),
    currentInvocationId: current,
    inventorySha256: `sha256:${createHash("sha256").update(inventory).digest("hex")}`,
    observedAt: input.observedAt,
  };
}
