import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { MandateInstallationPlan, OperatingMandate } from "@lervo/application-contract";
import {
  createRepositoryMandatePlan,
  inspectRepositoryMandate,
  installRepositoryMandate,
  revokeRepositoryMandate,
  selectRepositoryMandateWorkScope,
} from "./mandate-installation.js";
import type { CliIo } from "./types.js";
import { observeSupervisionHostIdentity } from "@lervo/node-runtime";

export const agentMandateUsage = [
  "  lervo agent mandate host [--json]",
  "  lervo agent mandate scope [--workstream <id>] [--root <path>] [--json]",
  "  lervo agent mandate plan --from <mandate.json> --supervision <id> --reviewer <id> [--root <path>] [--json]",
  "  lervo agent mandate install --from <plan.json> --approve <hash> --reviewer <id> --write [--root <path>] [--json]",
  "  lervo agent mandate inspect --supervision <id> [--workstream <id>] [--root <path>] [--json]",
  "  lervo agent mandate revoke --supervision <id> --workstream <id> --mandate-hash <hash> --installation-event <id> --reviewer <id> --write [--root <path>] [--json]",
].join("\n");

export async function runAgentMandateCommand(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      from: { type: "string" },
      supervision: { type: "string" },
      reviewer: { type: "string" },
      workstream: { type: "string" },
      approve: { type: "string" },
      write: { type: "boolean" },
      "mandate-hash": { type: "string" },
      "installation-event": { type: "string" },
    },
  });
  if (values.help) {
    io.stdout(`${agentMandateUsage}\n`);
    return 0;
  }
  if (positionals.length !== 1) throw new Error("Specify one mandate action.");
  const action = positionals[0];
  const allowed =
    action === "host"
      ? []
      : action === "scope"
        ? ["workstream"]
        : action === "plan"
          ? ["from", "supervision", "reviewer"]
          : action === "install"
            ? ["from", "approve", "reviewer", "write"]
            : action === "inspect"
              ? ["supervision", "workstream"]
              : action === "revoke"
                ? [
                    "supervision",
                    "workstream",
                    "mandate-hash",
                    "installation-event",
                    "reviewer",
                    "write",
                  ]
                : null;
  if (
    allowed === null ||
    Object.keys(values).some((key) => !["root", "json", ...allowed].includes(key))
  )
    throw new Error("The mandate action or its options are invalid.");
  const required = (key: keyof typeof values): string => {
    const value = values[key];
    if (typeof value !== "string" || value.length === 0)
      throw new Error(`Mandate ${action} requires --${key}.`);
    return value;
  };
  const root = resolve(io.cwd, values.root ?? ".");
  let result: unknown;
  if (action === "host") {
    result = await observeSupervisionHostIdentity();
  } else if (action === "scope") {
    result = await selectRepositoryMandateWorkScope({
      root,
      ...(values.workstream === undefined ? {} : { workstreamId: values.workstream }),
    });
  } else if (action === "plan" || action === "install") {
    if (action === "install" && !values.write)
      throw new Error("Mandate installation requires --write.");
    const content = await readFile(resolve(io.cwd, required("from")), "utf8");
    if (Buffer.byteLength(content) > 256 * 1024)
      throw new Error("The mandate input exceeds 256 KiB.");
    const input: unknown = JSON.parse(content);
    result =
      action === "plan"
        ? await createRepositoryMandatePlan({
            root,
            supervisionId: required("supervision"),
            reviewerId: required("reviewer"),
            mandate: input as OperatingMandate,
          })
        : await installRepositoryMandate({
            root,
            plan: input as MandateInstallationPlan,
            approval: required("approve"),
            reviewerId: required("reviewer"),
          });
  } else if (action === "inspect") {
    result = await inspectRepositoryMandate({
      root,
      supervisionId: required("supervision"),
      ...(values.workstream === undefined ? {} : { workstreamId: values.workstream }),
    });
  } else {
    if (!values.write) throw new Error("Mandate revocation requires --write.");
    result = await revokeRepositoryMandate({
      root,
      supervisionId: required("supervision"),
      workstreamId: required("workstream"),
      mandateHash: required("mandate-hash"),
      installationEventId: required("installation-event"),
      reviewerId: required("reviewer"),
    });
  }
  io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}
