// ADR-0658: what stops the project CAS from shrinking, as attention issues. The retention pass runs
// in every knowledge worker cycle and records its outcome; a pass that cannot finish must never
// stay invisible, since the store then grows without bound.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { TerminalLifecycleInspection } from "./terminal-hook-contract.js";

type Issue = TerminalLifecycleInspection["issues"][number];

const OBSERVATION = ".lervo/state/knowledge/cas-retention-observation.json";

const COMMANDS: Record<string, (reference: string) => string> = {
  unreadable_reference: (path) =>
    `make ${path} readable by the user that runs Lervo, or remove it if Lervo left it behind (for example: sudo chown -R "$USER" ${path}); Lervo runs without root and never changes it`,
  unsafe_reference: (path) =>
    `replace the link ${path} with the file or directory it points to; Lervo never follows links in its own state`,
  unsupported_reference: (path) =>
    `remove the special file ${path} from Lervo's state directories; only regular files, directories, pipes and sockets are allowed there`,
  unstable_reference: (path) =>
    `stop whatever rewrites ${path} continuously; retention reads it again on the next cycle`,
  bound_exceeded: () =>
    "run lervo state cas-retention --plan to see the store; a finite bound on files, events or record size stopped retention",
  failed: () => "run lervo doctor; retention stopped for a reason it could not name",
};

/** The retention outcome's attention issue, or none while retention runs or has nothing to say. */
export async function readCasRetentionAttention(root: string): Promise<Issue[]> {
  let observation: { status?: unknown; failure?: unknown; reference?: unknown };
  try {
    observation = JSON.parse(await readFile(join(root, OBSERVATION), "utf8")) as typeof observation;
  } catch {
    return [];
  }
  const failure = typeof observation.failure === "string" ? observation.failure : null;
  if (failure === null || !(failure in COMMANDS)) return [];
  if (observation.status !== "unavailable" && failure !== "unstable_reference") return [];
  const reference = typeof observation.reference === "string" ? observation.reference : "";
  return [
    {
      code: `cas_retention_${failure}`,
      command: COMMANDS[failure]!(reference),
      ...(reference === "" ? {} : { detail: reference }),
    },
  ];
}
