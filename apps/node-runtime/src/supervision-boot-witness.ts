import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { PreTurnBootWitness } from "./supervision-pre-turn-failure.js";

const BOOT_ID = /^[a-f0-9]{32}$/u;
const BOOT_LINE =
  /^\s*-?\d+\s+([a-f0-9]{32})\s+\w+\s+(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC\s+\w+\s+(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC\s*$/u;

function utc(value: string): string {
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("The boot inventory time is invalid.");
  return parsed.toISOString();
}

export function currentLinuxBootId(): string {
  const id = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim().replaceAll("-", "");
  if (!BOOT_ID.test(id)) throw new Error("The current Linux boot ID is unavailable.");
  return id;
}

/** Read the kernel journal and current boot locally; caller must recheck the boot at commit. */
export function observePreTurnBootWitness(
  incidentAt: string,
  observedAt: string,
): PreTurnBootWitness {
  const inventory = execFileSync("journalctl", ["--list-boots", "--no-pager"], {
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
    timeout: 5000,
    maxBuffer: 64 * 1024,
  });
  const boots = inventory
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const match = BOOT_LINE.exec(line);
      if (match === null) throw new Error("The boot inventory format is unsupported.");
      return { id: match[1]!, first: utc(match[2]!), last: utc(match[3]!) };
    });
  const incident = Date.parse(incidentAt);
  if (!Number.isFinite(incident)) throw new Error("The incident time is invalid.");
  const candidates = boots.filter(
    (boot) => Date.parse(boot.first) <= incident && incident <= Date.parse(boot.last),
  );
  if (candidates.length !== 1) throw new Error("The incident has no unique historical boot.");
  const index = boots.indexOf(candidates[0]!);
  const successor = boots[index + 1];
  const current = currentLinuxBootId();
  if (
    successor === undefined ||
    current === candidates[0]!.id ||
    boots.at(-1)?.id !== current ||
    Date.parse(candidates[0]!.last) >= Date.parse(successor.first) ||
    Date.parse(successor.first) > Date.parse(observedAt)
  )
    throw new Error("The old process has no observed successor boot fence.");
  return {
    schemaVersion: 1,
    kind: "host.boot_transition_witness",
    incidentAt,
    incidentBootId: candidates[0]!.id,
    incidentBootFirstAt: candidates[0]!.first,
    incidentBootLastAt: candidates[0]!.last,
    successorBootId: successor.id,
    successorBootFirstAt: successor.first,
    currentBootId: current,
    inventorySha256: `sha256:${createHash("sha256").update(inventory).digest("hex")}`,
    observedAt,
  };
}
