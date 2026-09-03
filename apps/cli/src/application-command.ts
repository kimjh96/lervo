import { parseArgs } from "node:util";

import { createProductHostCapabilityReport } from "./product-host-capabilities.js";
import type { CliIo } from "./types.js";

export const applicationUsage = "  lervo application capabilities [--json]";

function formatProductHostCapabilities(): string {
  const report = createProductHostCapabilityReport();
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

export async function runApplicationCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${applicationUsage}\n`);
      return 0;
    }
    if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "capabilities") {
      throw new Error("The application action is invalid.");
    }
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(createProductHostCapabilityReport(), null, 2)}\n`
        : formatProductHostCapabilities(),
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Application command failed: ${error instanceof Error ? error.message : String(error)}\n${applicationUsage}\n`,
    );
    return 1;
  }
}
