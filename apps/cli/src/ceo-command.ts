import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  CeoCommandRequest,
  CeoPolicy,
  OrganizationOperatingReport,
} from "@lervo/application-contract";
import { decideCeoCommand } from "@lervo/work-controller";

import type { CliIo } from "./types.js";

export async function readOrganizationCommandJson(path: string, label: string): Promise<unknown> {
  const bytes = await readFile(path);
  if (bytes.byteLength > 256 * 1024) throw new Error(`${label} exceeds 256 KiB.`);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error });
  }
}

export async function runCeoEvaluationCommand(input: {
  io: CliIo;
  policyPath: string;
  requestPath: string;
  reportPath: string;
  json: boolean | undefined;
}): Promise<number> {
  const [policy, request, organization] = await Promise.all([
    readOrganizationCommandJson(resolve(input.io.cwd, input.policyPath), "The CEO policy"),
    readOrganizationCommandJson(resolve(input.io.cwd, input.requestPath), "The CEO request"),
    readOrganizationCommandJson(resolve(input.io.cwd, input.reportPath), "The organization report"),
  ]);
  const decision = decideCeoCommand({
    policy: policy as CeoPolicy,
    request: request as CeoCommandRequest,
    organization: organization as OrganizationOperatingReport,
  });
  input.io.stdout(
    input.json
      ? `${JSON.stringify(decision, null, 2)}\n`
      : `${decision.status} · ${decision.reason}\n`,
  );
  return 0;
}
