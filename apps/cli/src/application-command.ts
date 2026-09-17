import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { formatOperatingAttention } from "./operating-attention-format.js";
import { inspectOperatingAttention } from "./operating-attention-inspection.js";
import { formatOperatingLiveness } from "./operating-liveness-format.js";
import { inspectOperatingLiveness } from "./operating-liveness-inspection.js";
import {
  inspectProductActivity,
  type InspectProductActivity,
} from "./product-activity-inspection.js";
import {
  inspectProductDeliberation,
  type InspectProductDeliberation,
} from "./product-deliberation-inspection.js";
import {
  inspectProductObservability,
  type InspectProductObservability,
} from "./product-observability-inspection.js";
import { createProductHostCapabilityReport } from "./product-host-capabilities.js";
import {
  formatProductActivity,
  formatProductDeliberation,
  formatProductHostCapabilities,
  formatProductObservability,
  formatProductSearch,
} from "./product-host-format.js";
import { inspectProductSearch, type InspectProductSearch } from "./product-search-inspection.js";
import type { CliIo, CliServices } from "./types.js";

export const applicationUsage = [
  "  lervo application capabilities [--protocol <1|2|3|4|5|6|7|8|9|10|11>] [--json]",
  "  lervo application activity [--cursor <cursor>] [--limit <1..100>] [--root <path>] [--json]",
  "  lervo application search [--corpus repository_knowledge] [--limit <1..100>] [--root <path>] [--json] <query>",
  "  lervo application observability --work <work-id> [--origin <coordinate>] [--root <path>] [--json]",
  "  lervo application deliberation --deliberation <deliberation-id> --integration <integration-id> [--root <path>] [--json]",
  "  lervo application attention [--root <path>] [--json]",
  "  lervo application liveness [--stale-after-ms <ms>] [--root <path>] [--json]",
].join("\n");

type ApplicationServices = Pick<
  CliServices,
  "inspectOperatingAttention" | "inspectOperatingLiveness"
> & {
  inspectProductActivity?: InspectProductActivity;
  inspectProductDeliberation?: InspectProductDeliberation;
  inspectProductObservability?: InspectProductObservability;
  inspectProductSearch?: InspectProductSearch;
};

function positiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value) || Number(value) < 1)
    throw new Error("--stale-after-ms must be a positive integer.");
  return Number(value);
}

function activityLimit(value: string | undefined): number {
  if (value === undefined) return 25;
  if (!/^\d+$/u.test(value) || Number(value) < 1 || Number(value) > 100) {
    throw new Error("--limit must be an integer between 1 and 100.");
  }
  return Number(value);
}

export async function runApplicationCommand(
  args: string[],
  io: CliIo,
  services: ApplicationServices = {
    inspectOperatingAttention,
    inspectOperatingLiveness,
    inspectProductActivity,
    inspectProductDeliberation,
    inspectProductObservability,
    inspectProductSearch,
  },
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
        cursor: { type: "string" },
        limit: { type: "string" },
        corpus: { type: "string" },
        work: { type: "string" },
        origin: { type: "string" },
        deliberation: { type: "string" },
        integration: { type: "string" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${applicationUsage}\n`);
      return 0;
    }
    if (parsed.positionals.length === 0) {
      throw new Error("The application action is invalid.");
    }
    if (parsed.positionals[0] === "attention") {
      if (
        parsed.positionals.length !== 1 ||
        parsed.values.protocol !== undefined ||
        parsed.values["stale-after-ms"] !== undefined ||
        parsed.values.cursor !== undefined ||
        parsed.values.limit !== undefined ||
        parsed.values.corpus !== undefined ||
        parsed.values.work !== undefined ||
        parsed.values.origin !== undefined ||
        parsed.values.deliberation !== undefined ||
        parsed.values.integration !== undefined
      )
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
      if (
        parsed.positionals.length !== 1 ||
        parsed.values.protocol !== undefined ||
        parsed.values.cursor !== undefined ||
        parsed.values.limit !== undefined ||
        parsed.values.corpus !== undefined ||
        parsed.values.work !== undefined ||
        parsed.values.origin !== undefined ||
        parsed.values.deliberation !== undefined ||
        parsed.values.integration !== undefined
      )
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
    if (parsed.positionals[0] === "activity") {
      if (
        parsed.positionals.length !== 1 ||
        parsed.values.protocol !== undefined ||
        parsed.values["stale-after-ms"] !== undefined ||
        parsed.values.corpus !== undefined ||
        parsed.values.work !== undefined ||
        parsed.values.origin !== undefined ||
        parsed.values.deliberation !== undefined ||
        parsed.values.integration !== undefined
      ) {
        throw new Error("Activity inspection rejects capability and liveness options.");
      }
      const report = await (services.inspectProductActivity ?? inspectProductActivity)({
        repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
        cursor: parsed.values.cursor ?? null,
        limit: activityLimit(parsed.values.limit),
      });
      io.stdout(
        parsed.values.json ? `${JSON.stringify(report, null, 2)}\n` : formatProductActivity(report),
      );
      return 0;
    }
    if (parsed.positionals[0] === "search") {
      if (
        parsed.values.protocol !== undefined ||
        parsed.values["stale-after-ms"] !== undefined ||
        parsed.values.cursor !== undefined ||
        parsed.values.work !== undefined ||
        parsed.values.origin !== undefined ||
        parsed.values.deliberation !== undefined ||
        parsed.values.integration !== undefined
      ) {
        throw new Error("Product search rejects capability, liveness, and cursor options.");
      }
      const query = parsed.positionals.slice(1).join(" ").trim();
      if (query === "") throw new Error("Product search requires a query.");
      const corpusClass = parsed.values.corpus ?? "repository_knowledge";
      if (corpusClass !== "repository_knowledge") {
        throw new Error("Only the repository_knowledge product-search corpus is installed.");
      }
      const result = await (services.inspectProductSearch ?? inspectProductSearch)({
        repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
        query,
        corpusClass,
        limit: activityLimit(parsed.values.limit),
      });
      io.stdout(
        parsed.values.json ? `${JSON.stringify(result, null, 2)}\n` : formatProductSearch(result),
      );
      return 0;
    }
    if (parsed.positionals[0] === "observability") {
      if (
        parsed.positionals.length !== 1 ||
        parsed.values.protocol !== undefined ||
        parsed.values["stale-after-ms"] !== undefined ||
        parsed.values.cursor !== undefined ||
        parsed.values.limit !== undefined ||
        parsed.values.corpus !== undefined ||
        parsed.values.deliberation !== undefined ||
        parsed.values.integration !== undefined
      ) {
        throw new Error("Product observability rejects capability, activity, and search options.");
      }
      if (parsed.values.work === undefined) {
        throw new Error("Product observability requires --work <work-id>.");
      }
      const report = await (services.inspectProductObservability ?? inspectProductObservability)({
        repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
        workId: parsed.values.work,
        originCoordinate: parsed.values.origin ?? null,
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : formatProductObservability(report),
      );
      return 0;
    }
    if (parsed.positionals[0] === "deliberation") {
      if (
        parsed.positionals.length !== 1 ||
        parsed.values.protocol !== undefined ||
        parsed.values["stale-after-ms"] !== undefined ||
        parsed.values.cursor !== undefined ||
        parsed.values.limit !== undefined ||
        parsed.values.corpus !== undefined ||
        parsed.values.work !== undefined ||
        parsed.values.origin !== undefined ||
        parsed.values.deliberation === undefined ||
        parsed.values.integration === undefined
      ) {
        throw new Error(
          "Product deliberation requires exact --deliberation and --integration coordinates.",
        );
      }
      const view = await (services.inspectProductDeliberation ?? inspectProductDeliberation)({
        repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
        deliberationId: parsed.values.deliberation,
        integrationId: parsed.values.integration,
      });
      io.stdout(
        parsed.values.json ? `${JSON.stringify(view, null, 2)}\n` : formatProductDeliberation(view),
      );
      return 0;
    }
    if (
      parsed.positionals[0] !== "capabilities" ||
      parsed.positionals.length !== 1 ||
      parsed.values.root !== undefined
    ) {
      throw new Error("The application action is invalid.");
    }
    if (
      parsed.values["stale-after-ms"] !== undefined ||
      parsed.values.cursor !== undefined ||
      parsed.values.limit !== undefined ||
      parsed.values.corpus !== undefined ||
      parsed.values.work !== undefined ||
      parsed.values.origin !== undefined ||
      parsed.values.deliberation !== undefined ||
      parsed.values.integration !== undefined
    ) {
      throw new Error("Activity and liveness options do not apply to capability discovery.");
    }
    const protocolVersion =
      parsed.values.protocol === undefined || parsed.values.protocol === "1"
        ? 1
        : parsed.values.protocol === "2"
          ? 2
          : parsed.values.protocol === "3"
            ? 3
            : parsed.values.protocol === "4"
              ? 4
              : parsed.values.protocol === "5"
                ? 5
                : parsed.values.protocol === "6"
                  ? 6
                  : parsed.values.protocol === "7"
                    ? 7
                    : parsed.values.protocol === "8"
                      ? 8
                      : parsed.values.protocol === "9"
                        ? 9
                        : parsed.values.protocol === "10"
                          ? 10
                          : parsed.values.protocol === "11"
                            ? 11
                            : (() => {
                                throw new Error(
                                  "--protocol must be 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, or 11.",
                                );
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
