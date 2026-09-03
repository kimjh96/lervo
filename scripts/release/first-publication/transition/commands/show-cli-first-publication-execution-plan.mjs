import { isAbsolute } from "node:path";

import { createCliFirstPublicationExecutionPlan } from "../cli-first-publication-execution-plan.mjs";
import { formatFirstPublicationExecutionPlan } from "../first-publication-execution-plan-formatter.mjs";
import { FirstPublicationBootstrapError } from "../first-publication-bootstrap.mjs";
import { ReleaseAttestationVerificationError } from "../../../lib/release-attestation-consumer.mjs";
import { ReleasePublicationAuthorizationError } from "../../../lib/release-publication-authorization.mjs";

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_execution_plan_arguments_invalid",
    "The CLI first-publication execution-plan command arguments are invalid.",
  );
}

function parseArguments(args) {
  const values = new Map();
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--json") {
      if (json) failArguments();
      json = true;
      continue;
    }
    if (
      !["--publication-authorization", "--bootstrap"].includes(name) ||
      values.has(name) ||
      index + 1 >= args.length
    )
      failArguments();
    values.set(name, args[index + 1]);
    index += 1;
  }
  if (
    !["--publication-authorization", "--bootstrap"].every((name) =>
      isAbsolute(values.get(name) ?? ""),
    )
  )
    failArguments();
  return {
    json,
    publicationAuthorizationPath: values.get("--publication-authorization"),
    bootstrapPath: values.get("--bootstrap"),
  };
}

try {
  const { json, ...options } = parseArguments(process.argv.slice(2));
  const plan = await createCliFirstPublicationExecutionPlan(options);
  process.stdout.write(
    json ? `${JSON.stringify(plan, null, 2)}\n` : formatFirstPublicationExecutionPlan(plan),
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleasePublicationAuthorizationError
  )
    console.error(`${error.code}: ${error.message}`);
  else
    console.error(
      "first_publication_execution_plan_failed: The CLI first-publication execution plan could not be created.",
    );
  process.exitCode = 1;
}
