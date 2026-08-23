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
    "first_publication_stage_approval_execution_arguments_invalid",
    "The CLI npm stage approval execution command arguments are invalid.",
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

export function parseFirstPublicationStageApprovalExecutionArguments(args) {
  const flags = new Set();
  const values = new Map();
  const valueNames = [
    "--repository", "--source-commit", "--release-tag", "--run-id", "--attempt",
    "--stage-review-report", "--decision", "--authorization", "--npm-user-config",
    "--result-directory",
  ];
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (["--online", "--write", "--json"].includes(name)) {
      if (flags.has(name)) fail();
      flags.add(name);
      continue;
    }
    if (!valueNames.includes(name) || values.has(name) || index + 1 >= args.length ||
        args[index + 1].startsWith("--")) fail();
    values.set(name, args[index + 1]);
    index += 1;
  }
  try {
    validateWorkflowReachabilityCommit(values.get("--source-commit"));
    validateWorkflowReachabilityReleaseTag(values.get("--release-tag"));
  } catch {
    fail();
  }
  const pathNames = [
    "--stage-review-report", "--decision", "--authorization", "--npm-user-config",
    "--result-directory",
  ];
  if (
    !flags.has("--online") || !flags.has("--write") ||
    values.size !== valueNames.length ||
    pathNames.some((name) => !isAbsolute(values.get(name) ?? ""))
  ) fail();
  return {
    repository: values.get("--repository"),
    sourceCommit: values.get("--source-commit"),
    releaseTag: values.get("--release-tag"),
    runId: coordinate(values.get("--run-id")),
    attempt: coordinate(values.get("--attempt")),
    stageReviewReportPath: values.get("--stage-review-report"),
    decisionPath: values.get("--decision"),
    authorizationPath: values.get("--authorization"),
    npmUserConfigPath: values.get("--npm-user-config"),
    resultDirectory: values.get("--result-directory"),
    online: true,
    write: true,
    json: flags.has("--json"),
  };
}
