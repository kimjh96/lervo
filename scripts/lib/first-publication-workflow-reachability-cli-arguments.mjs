import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "./first-publication-workflow-reachability-contract.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_reachability_arguments_invalid",
    "CLI stage-only workflow ref 도달 가능성 증거 명령 인자가 올바르지 않습니다.",
  );
}

export function parseFirstPublicationWorkflowReachabilityArguments(args) {
  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (["--online", "--json"].includes(name)) {
      if (flags.has(name)) fail();
      flags.add(name);
      continue;
    }
    if (
      ![
        "--repository", "--source-commit", "--release-tag",
        "--remote-evidence-report",
      ].includes(name) || values.has(name) || index + 1 >= args.length ||
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
    !flags.has("--online") || values.size !== 4 ||
    !isAbsolute(values.get("--remote-evidence-report") ?? "")
  ) fail();
  return {
    repository: values.get("--repository"),
    sourceCommit: values.get("--source-commit"),
    releaseTag: values.get("--release-tag"),
    remoteEvidenceReportPath: values.get("--remote-evidence-report"),
    online: true,
    json: flags.has("--json"),
  };
}
