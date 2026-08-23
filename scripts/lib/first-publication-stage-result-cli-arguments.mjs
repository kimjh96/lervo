import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateWorkflowExecutionCoordinate } from
  "./first-publication-workflow-execution-contract.mjs";
import {
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "./first-publication-workflow-reachability-contract.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_stage_result_arguments_invalid",
    "The CLI npm stage-result evidence command arguments are invalid.",
  );
}

function coordinate(value) {
  if (!/^[1-9]\d*$/u.test(value ?? "")) fail();
  try {
    return validateWorkflowExecutionCoordinate(Number(value));
  } catch {
    fail();
  }
}

export function parseFirstPublicationStageResultArguments(args) {
  const flags = new Set();
  const values = new Map();
  const valueNames = [
    "--repository", "--source-commit", "--release-tag", "--run-id", "--attempt",
    "--workflow-execution-report",
  ];
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (["--online", "--json"].includes(name)) {
      if (flags.has(name)) fail();
      flags.add(name);
      continue;
    }
    if (
      !valueNames.includes(name) || values.has(name) || index + 1 >= args.length ||
      args[index + 1].startsWith("--")
    ) fail();
    values.set(name, args[index + 1]);
    index += 1;
  }
  try {
    validateWorkflowReachabilityCommit(values.get("--source-commit"));
    validateWorkflowReachabilityReleaseTag(values.get("--release-tag"));
  } catch {
    fail();
  }
  if (
    !flags.has("--online") || values.size !== valueNames.length ||
    !isAbsolute(values.get("--workflow-execution-report") ?? "")
  ) fail();
  return {
    repository: values.get("--repository"),
    sourceCommit: values.get("--source-commit"),
    releaseTag: values.get("--release-tag"),
    runId: coordinate(values.get("--run-id")),
    attempt: coordinate(values.get("--attempt")),
    workflowExecutionReportPath: values.get("--workflow-execution-report"),
    online: true,
    json: flags.has("--json"),
  };
}
