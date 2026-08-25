import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_activation_post_apply_arguments_invalid",
    "The CLI first-publication workflow activation post-apply verification command arguments are invalid.",
  );
}

export function parseFirstPublicationWorkflowActivationPostApplyArguments(args) {
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
      !["--repository", "--receipt"].includes(name) ||
      values.has(name) ||
      index + 1 >= args.length ||
      args[index + 1].startsWith("--")
    )
      fail();
    values.set(name, args[index + 1]);
    index += 1;
  }
  if (!flags.has("--online") || values.size !== 2 || !isAbsolute(values.get("--receipt") ?? ""))
    fail();
  return {
    repository: values.get("--repository"),
    receiptPath: values.get("--receipt"),
    online: true,
    json: flags.has("--json"),
  };
}
