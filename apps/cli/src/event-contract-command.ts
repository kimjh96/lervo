import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  applyEventWriterActivationPlan,
  EventWriterActivationError,
  eventWriterActivationObservationHash,
  inspectEventWriterCoordinate,
  loadProjectManifest,
  planEventWriterActivation,
  planEventWriterRollback,
  recoverEventWriterActivation,
  readEventWriterActivationEvidence,
} from "@lervo/project";

import { collectEventReaderActivationEvidence } from "./event-reader-inventory.js";
import type { CliIo } from "./types.js";
import {
  readableEventSchemaVersions,
  type ActivatableEventSchemaVersion,
} from "@lervo/event-contract";

const maximumEvidenceBytes = 64 * 1024;

export interface EventContractCommandPorts {
  collectEvidence?: typeof collectEventReaderActivationEvidence;
}

export const eventContractUsage = `  lervo event-contract status [--root <path>] [--json]
  lervo event-contract evidence [--root <path>] [--json]
  lervo event-contract activate (--from <path> | --stdin) [--schema-version <2-15>] [--apply <plan-id>] [--root <path>] [--json]
  lervo event-contract rollback [--apply <plan-id>] [--root <path>] [--json]
  lervo event-contract recover [--root <path>] [--json]`;

function publicPlan(plan: Awaited<ReturnType<typeof planEventWriterActivation>>) {
  const {
    desiredContent: _desiredContent,
    activationEvidence: _activationEvidence,
    ...safe
  } = plan;
  return safe;
}

async function readEvidence(
  from: string | undefined,
  useStdin: boolean,
  io: CliIo,
): Promise<unknown> {
  if ((from === undefined) === !useStdin) {
    throw new Error("Activation requires exactly one of --from or --stdin.");
  }
  if (useStdin && io.stdin === undefined) throw new Error("Standard input is unavailable.");
  const content =
    from === undefined ? await io.stdin!() : await readFile(resolve(io.cwd, from), "utf8");
  if (Buffer.byteLength(content, "utf8") > maximumEvidenceBytes) {
    throw new Error("Activation evidence exceeds the 64 KiB limit.");
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("Activation evidence must be valid JSON.");
  }
}

function formatStatus(status: Awaited<ReturnType<typeof inspectEventWriterCoordinate>>): string {
  return `Event writer: schema version ${status.coordinate.selectedEventSchemaVersion}\n  Source: ${status.source}\n  Coordinate: .lervo/data/event-contract.json\n`;
}

export async function runEventContractCommand(
  args: string[],
  io: CliIo,
  ports: EventContractCommandPorts = {},
): Promise<number> {
  try {
    const collectEvidence = ports.collectEvidence ?? collectEventReaderActivationEvidence;
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        from: { type: "string" },
        stdin: { type: "boolean" },
        apply: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        "schema-version": { type: "string" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${eventContractUsage}\n`);
      return 0;
    }
    if (parsed.positionals.length !== 1) throw new Error("Specify one event-contract action.");
    const action = parsed.positionals[0];
    const selectedVersion = parsed.values["schema-version"] ?? "2";
    const activationVersions = readableEventSchemaVersions
      .filter((version) => version > 1)
      .map(String);
    if (
      !activationVersions.includes(selectedVersion) ||
      (parsed.values["schema-version"] !== undefined && action !== "activate")
    ) {
      throw new Error(
        `--schema-version accepts ${activationVersions.join(", ")} for activation only.`,
      );
    }
    const targetEventSchemaVersion = Number(selectedVersion) as ActivatableEventSchemaVersion;
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    if (action === "status") {
      if (parsed.values.from || parsed.values.stdin || parsed.values.apply) {
        throw new Error("Status does not accept activation options.");
      }
      const status = await inspectEventWriterCoordinate(repositoryRoot);
      io.stdout(parsed.values.json ? `${JSON.stringify(status, null, 2)}\n` : formatStatus(status));
      return 0;
    }
    if (action === "evidence") {
      if (parsed.values.from || parsed.values.stdin || parsed.values.apply) {
        throw new Error("Evidence does not accept activation options.");
      }
      const evidence = await collectEvidence({ repositoryRoot });
      io.stdout(`${JSON.stringify(evidence, null, 2)}\n`);
      return 0;
    }
    if (action === "activate") {
      const evidence = await readEvidence(parsed.values.from, parsed.values.stdin === true, io);
      const suppliedEvidence = readEventWriterActivationEvidence(evidence);
      const manifest = await loadProjectManifest(repositoryRoot);
      const currentEvidence =
        manifest.dataPolicy.hubSyncEnabled || targetEventSchemaVersion >= 3
          ? await collectEvidence({ repositoryRoot })
          : undefined;
      if (
        currentEvidence !== undefined &&
        eventWriterActivationObservationHash(suppliedEvidence) !==
          eventWriterActivationObservationHash(currentEvidence)
      ) {
        throw new EventWriterActivationError(
          "event_writer_plan_stale",
          "The supplied reader evidence differs from the current authoritative inventory.",
        );
      }
      const plan = await planEventWriterActivation({
        repositoryRoot,
        evidence: suppliedEvidence,
        targetEventSchemaVersion,
      });
      if (parsed.values.apply === undefined) {
        io.stdout(`${JSON.stringify(publicPlan(plan), null, 2)}\n`);
        return plan.status === "blocked" ? 1 : 0;
      }
      const receipt = await applyEventWriterActivationPlan({
        plan,
        approval: parsed.values.apply,
        ...(currentEvidence === undefined ? {} : { currentEvidence }),
      });
      io.stdout(`${JSON.stringify(receipt, null, 2)}\n`);
      return 0;
    }
    if (action === "rollback") {
      if (parsed.values.from || parsed.values.stdin) {
        throw new Error("Rollback does not accept activation evidence.");
      }
      const plan = await planEventWriterRollback(repositoryRoot);
      if (parsed.values.apply === undefined) {
        io.stdout(`${JSON.stringify(publicPlan(plan), null, 2)}\n`);
        return 0;
      }
      const receipt = await applyEventWriterActivationPlan({
        plan,
        approval: parsed.values.apply,
      });
      io.stdout(`${JSON.stringify(receipt, null, 2)}\n`);
      return 0;
    }
    if (action === "recover") {
      if (parsed.values.from || parsed.values.stdin || parsed.values.apply) {
        throw new Error("Recover does not accept activation options.");
      }
      const result = await recoverEventWriterActivation(repositoryRoot);
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    throw new Error("The event-contract action is invalid.");
  } catch (error) {
    const code =
      typeof (error as { code?: unknown }).code === "string"
        ? `${(error as { code: string }).code}: `
        : "";
    io.stderr(
      `${code}${error instanceof Error ? error.message : String(error)}\n${eventContractUsage}\n`,
    );
    return 1;
  }
}
