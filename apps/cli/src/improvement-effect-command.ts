import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type {
  ImprovementEffectObservationRequestV1,
  ImprovementEvaluationProtocolRequestV1,
} from "@lervo/application-contract";

import { routeImprovementEffect, routeImprovementProtocol } from "./improvement-effect-routing.js";
import type { CliIo, CliServices } from "./types.js";

export const improvementEffectUsage = `  lervo knowledge pattern effect register --from <protocol.json> [--apply <plan-id> --write] [--root <path>] [--json]
  lervo knowledge pattern effect observe --from <observation.json> [--apply <plan-id> --write] [--root <path>] [--json]`;

async function readRequest<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content) > 64 * 1024)
    throw new Error("The improvement-effect request exceeds 64 KiB.");
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error("The improvement-effect request must be valid JSON.");
  }
}

export async function runImprovementEffectCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "improvementObservationPort"> = {},
): Promise<number> {
  try {
    const action = args[0];
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: {
        from: { type: "string" },
        apply: { type: "string" },
        write: { type: "boolean" },
        root: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${improvementEffectUsage}\n`);
      return 0;
    }
    if (
      !["register", "observe"].includes(action ?? "") ||
      parsed.values.from === undefined ||
      (parsed.values.apply === undefined) !== !(parsed.values.write ?? false)
    )
      throw new Error(
        "Effect routing requires register or observe, a request, and paired apply/write fields.",
      );
    const common = {
      repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
      ...(parsed.values.apply === undefined ? {} : { applyPlanId: parsed.values.apply }),
      ...(services.improvementObservationPort === undefined
        ? {}
        : { observer: services.improvementObservationPort }),
    };
    const requestPath = resolve(io.cwd, parsed.values.from);
    const result =
      action === "register"
        ? await routeImprovementProtocol({
            ...common,
            request: await readRequest<ImprovementEvaluationProtocolRequestV1>(requestPath),
          })
        : await routeImprovementEffect({
            ...common,
            request: await readRequest<ImprovementEffectObservationRequestV1>(requestPath),
          });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Development-pattern effect ${action}: ${result.plan.status}; plan ${result.plan.planId}.\n`,
    );
    return result.plan.status === "blocked" ? 1 : 0;
  } catch (error) {
    io.stderr(
      `Development-pattern effect failed: ${error instanceof Error ? error.message : String(error)}\n${improvementEffectUsage}\n`,
    );
    return 1;
  }
}
