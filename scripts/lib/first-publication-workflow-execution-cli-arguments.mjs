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
    "first_publication_workflow_execution_arguments_invalid",
    "CLI stage-only workflow 실행 증거 명령 인자가 올바르지 않습니다.",
  );
}

function coordinate(value) {
  if (!/^[1-9]\d*$/u.test(value ?? "")) fail();
  const parsed = Number(value);
  try {
    return validateWorkflowExecutionCoordinate(parsed);
  } catch {
    fail();
  }
}

export function parseFirstPublicationWorkflowExecutionArguments(args) {
  const flags = new Set();
  const values = new Map();
  const valueNames = [
    "--repository", "--source-commit", "--release-tag", "--run-id", "--attempt",
    "--reachability-report",
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
    !isAbsolute(values.get("--reachability-report") ?? "")
  ) fail();
  return {
    repository: values.get("--repository"),
    sourceCommit: values.get("--source-commit"),
    releaseTag: values.get("--release-tag"),
    runId: coordinate(values.get("--run-id")),
    attempt: coordinate(values.get("--attempt")),
    reachabilityReportPath: values.get("--reachability-report"),
    online: true,
    json: flags.has("--json"),
  };
}
