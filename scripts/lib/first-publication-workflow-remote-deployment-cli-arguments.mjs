import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

const sourceCommitPattern = /^[a-f0-9]{40}$/u;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_remote_deployment_arguments_invalid",
    "CLI stage-only workflow 원격 배포 증거 명령 인자가 올바르지 않습니다.",
  );
}

export function parseFirstPublicationWorkflowRemoteDeploymentArguments(args) {
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
      !["--repository", "--source-commit", "--post-apply-report"].includes(name) ||
      values.has(name) || index + 1 >= args.length || args[index + 1].startsWith("--")
    ) fail();
    values.set(name, args[index + 1]);
    index += 1;
  }
  if (
    !flags.has("--online") || values.size !== 3 ||
    !sourceCommitPattern.test(values.get("--source-commit") ?? "") ||
    !isAbsolute(values.get("--post-apply-report") ?? "")
  ) fail();
  return {
    repository: values.get("--repository"),
    sourceCommit: values.get("--source-commit"),
    postApplyReportPath: values.get("--post-apply-report"),
    online: true,
    json: flags.has("--json"),
  };
}
