import { resolve } from "node:path";

import {
  createTraceCapabilitiesReport,
  createTracePage,
  createTraceReport,
} from "@lervo/diagnostics";

import { formatTracePageReport, formatTraceReport } from "./trace-format.js";
import {
  parseTraceCommandOptions,
  traceUsage,
} from "./trace-options.js";
import type { CliIo, CliServices } from "./types.js";

export async function runTraceCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "openProjectStorage">,
): Promise<number> {
  let options;
  try {
    options = parseTraceCommandOptions(args);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${traceUsage}\n`);
    return 1;
  }
  if (options.help) {
    io.stdout(`${traceUsage}\n`);
    return 0;
  }
  if (options.request.kind === "capabilities") {
    io.stdout(`${JSON.stringify(createTraceCapabilitiesReport(), null, 2)}\n`);
    return 0;
  }
  let storage;
  try {
    storage = await services.openProjectStorage(
      resolve(io.cwd, options.root ?? "."),
    );
    if (options.request.kind === "full") {
      const report = createTraceReport({
        projectId: storage.manifest.projectId,
        events: storage.events,
        selector: options.request.selector,
      });
      io.stdout(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatTraceReport(report));
    } else {
      const report = options.request.kind === "cursor"
        ? createTracePage({
            projectId: storage.manifest.projectId,
            events: storage.events,
            cursor: options.request.cursor,
          })
        : createTracePage({
            projectId: storage.manifest.projectId,
            events: storage.events,
            selector: options.request.selector,
            ...(options.request.limit === undefined ? {} : { limit: options.request.limit }),
            ...(options.request.eventTypes === undefined
              ? {}
              : { eventTypes: options.request.eventTypes }),
          });
      io.stdout(options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatTracePageReport(report));
    }
    return 0;
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : "trace_failed";
    io.stderr(`실행 기록을 조회하지 못했습니다. (${code}) ${
      error instanceof Error ? error.message : "알 수 없는 오류입니다."
    }\n`);
    return 1;
  } finally {
    await storage?.close().catch(() => undefined);
  }
}

export {
  formatTracePageReport,
  formatTraceReport,
  traceUsage,
};
