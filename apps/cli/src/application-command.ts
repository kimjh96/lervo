import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { ProductHostCapabilityReport } from "@lervo/application-contract";

import { formatOperatingAttention } from "./operating-attention-format.js";
import { inspectOperatingAttention } from "./operating-attention-inspection.js";
import { formatOperatingLiveness } from "./operating-liveness-format.js";
import { inspectOperatingLiveness } from "./operating-liveness-inspection.js";
import { createProductHostCapabilityReport } from "./product-host-capabilities.js";
import type { CliIo, CliServices } from "./types.js";

export const applicationUsage = [
  "  lervo application capabilities [--protocol <1|2|3|4>] [--json]",
  "  lervo application attention [--root <path>] [--json]",
  "  lervo application liveness [--stale-after-ms <ms>] [--root <path>] [--json]",
].join("\n");

type ApplicationServices = Pick<
  CliServices,
  "inspectOperatingAttention" | "inspectOperatingLiveness"
>;

function positiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value) || Number(value) < 1)
    throw new Error("--stale-after-ms must be a positive integer.");
  return Number(value);
}

function formatProductHostCapabilities(report: ProductHostCapabilityReport): string {
  return [
    `Lervo product-host protocol v${report.protocol.version}`,
    `transport: ${report.protocol.transport}`,
    `Hub required: ${report.protocol.requiresHub ? "yes" : "no"}`,
    "routes:",
    ...report.routes.map(
      (route) =>
        `  ${route.routeId} · ${route.operation} · ${route.authority} · lervo ${route.command.join(" ")}`,
    ),
    `unsupported: ${report.unsupported.join(", ")}`,
    "",
  ].join("\n");
}

export async function runApplicationCommand(
  args: string[],
  io: CliIo,
  services: ApplicationServices = { inspectOperatingAttention, inspectOperatingLiveness },
): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        protocol: { type: "string" },
        root: { type: "string" },
        "stale-after-ms": { type: "string" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${applicationUsage}\n`);
      return 0;
    }
    if (parsed.positionals.length !== 1) {
      throw new Error("The application action is invalid.");
    }
    if (parsed.positionals[0] === "attention") {
      if (parsed.values.protocol !== undefined || parsed.values["stale-after-ms"] !== undefined)
        throw new Error("Attention inspection rejects capability and liveness options.");
      const report = await services.inspectOperatingAttention({
        repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : formatOperatingAttention(report),
      );
      return 0;
    }
    if (parsed.positionals[0] === "liveness") {
      if (parsed.values.protocol !== undefined)
        throw new Error("--protocol applies only to capability discovery.");
      const staleAfterMs = positiveInteger(parsed.values["stale-after-ms"]);
      const report = await services.inspectOperatingLiveness({
        repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
        ...(staleAfterMs === undefined ? {} : { staleAfterMs }),
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : formatOperatingLiveness(report),
      );
      return 0;
    }
    if (parsed.positionals[0] !== "capabilities" || parsed.values.root !== undefined) {
      throw new Error("The application action is invalid.");
    }
    if (parsed.values["stale-after-ms"] !== undefined)
      throw new Error("--stale-after-ms applies only to liveness inspection.");
    const protocolVersion =
      parsed.values.protocol === undefined || parsed.values.protocol === "1"
        ? 1
        : parsed.values.protocol === "2"
          ? 2
          : parsed.values.protocol === "3"
            ? 3
            : parsed.values.protocol === "4"
              ? 4
              : (() => {
                  throw new Error("--protocol must be 1, 2, 3, or 4.");
                })();
    const report = createProductHostCapabilityReport(protocolVersion);
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatProductHostCapabilities(report),
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Application command failed: ${error instanceof Error ? error.message : String(error)}\n${applicationUsage}\n`,
    );
    return 1;
  }
}
