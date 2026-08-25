import { isAbsolute } from "node:path";

import {
  applyCliFirstPublicationWorkflowActivation,
  recoverCliFirstPublicationWorkflowActivation,
} from "./lib/cli-first-publication-workflow-activation-apply.mjs";
import { formatFirstPublicationWorkflowActivationApply } from "./lib/first-publication-workflow-activation-apply-formatter.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { ReleaseAttestationVerificationError } from "./lib/release-attestation-consumer.mjs";
import { TrustedPublisherReadinessError } from "./lib/trusted-publisher-readiness.mjs";

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_activation_apply_arguments_invalid",
    "The CLI first-publication workflow activation apply command arguments are invalid.",
  );
}

function parseArguments(args) {
  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (["--write", "--recover", "--online", "--json"].includes(name)) {
      if (flags.has(name)) failArguments();
      flags.add(name);
      continue;
    }
    if (
      !["--repository", "--decision", "--permit"].includes(name) ||
      values.has(name) ||
      index + 1 >= args.length
    )
      failArguments();
    values.set(name, args[index + 1]);
    index += 1;
  }
  if (flags.has("--recover")) {
    if (flags.has("--write") || flags.has("--online") || values.size > 0) failArguments();
    return { mode: "recover", json: flags.has("--json") };
  }
  if (
    !flags.has("--write") ||
    !flags.has("--online") ||
    values.size !== 3 ||
    !isAbsolute(values.get("--decision") ?? "") ||
    !isAbsolute(values.get("--permit") ?? "")
  )
    failArguments();
  return {
    mode: "apply",
    json: flags.has("--json"),
    options: {
      repository: values.get("--repository"),
      decisionPath: values.get("--decision"),
      permitPath: values.get("--permit"),
      online: true,
    },
  };
}

try {
  const parsed = parseArguments(process.argv.slice(2));
  const result =
    parsed.mode === "recover"
      ? await recoverCliFirstPublicationWorkflowActivation()
      : await applyCliFirstPublicationWorkflowActivation(parsed.options);
  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : formatFirstPublicationWorkflowActivationApply(result),
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof TrustedPublisherReadinessError
  )
    console.error(`${error.code}: ${error.message}`);
  else
    console.error(
      "first_publication_workflow_activation_apply_unexpected: " +
        "The CLI first-publication workflow activation apply could not be completed.",
    );
  process.exitCode = 1;
}
