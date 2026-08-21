import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_completion_inspection_arguments_invalid",
    "CLI 최초 게시 완료 점검 명령 인자가 올바르지 않습니다.",
  );
}

export function parseFirstPublicationCompletionInspectionArguments(args) {
  const names = ["--stage-approval-bundle", "--transition-receipt"];
  const values = new Map();
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--json") {
      if (json) fail();
      json = true;
      continue;
    }
    const value = args[index + 1];
    if (!names.includes(name) || values.has(name) || value === undefined ||
        value.startsWith("--")) fail();
    values.set(name, value);
    index += 1;
  }
  if (
    values.size !== names.length ||
    names.some((name) => !isAbsolute(values.get(name) ?? ""))
  ) fail();
  return {
    stageApprovalBundlePath: values.get("--stage-approval-bundle"),
    transitionReceiptPath: values.get("--transition-receipt"),
    json,
  };
}
