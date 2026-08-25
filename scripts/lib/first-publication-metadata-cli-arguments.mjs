import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

const valueArguments = ["--repository", "--license", "--scope-owner-kind", "--scope-owner-name"];

const permitValueArguments = [
  "--reviewed-candidate-digest",
  "--reviewed-source-sha256",
  "--reviewed-output-sha256",
];

const commandErrors = {
  preview: {
    code: "first_publication_metadata_preview_arguments_invalid",
    message: "The CLI first-publication metadata-change preview command arguments are invalid.",
  },
  candidate: {
    code: "first_publication_package_metadata_candidate_arguments_invalid",
    message: "The CLI first-publication package metadata candidate command arguments are invalid.",
  },
  permit: {
    code: "first_publication_package_metadata_apply_permit_arguments_invalid",
    message:
      "The CLI first-publication package metadata apply-permit command arguments are invalid.",
  },
};

function fail(command) {
  const error = commandErrors[command];
  if (error === undefined) throw new Error("unsupported metadata command");
  throw new FirstPublicationBootstrapError(error.code, error.message);
}

export function parseFirstPublicationMetadataArguments(args, command) {
  const values = new Map();
  let output = "human";
  let reviewConfirmed = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--confirm-reviewed-candidate") {
      if (command !== "permit" || reviewConfirmed) fail(command);
      reviewConfirmed = true;
      continue;
    }
    if (name === "--json" || name === "--package-json") {
      if (output !== "human" || (name === "--package-json" && command !== "candidate")) {
        fail(command);
      }
      output = name === "--json" ? "json" : "package_json";
      continue;
    }
    const value = args[index + 1];
    if (
      ![...valueArguments, ...(command === "permit" ? permitValueArguments : [])].includes(name) ||
      values.has(name) ||
      value === undefined ||
      value.startsWith("--")
    )
      fail(command);
    values.set(name, value);
    index += 1;
  }
  if (
    !valueArguments.every((name) => values.has(name)) ||
    (command === "permit" &&
      (!reviewConfirmed || !permitValueArguments.every((name) => values.has(name))))
  )
    fail(command);
  const parsed = {
    output,
    decisionInput: {
      repository: values.get("--repository"),
      license: values.get("--license"),
      scopeOwnerKind: values.get("--scope-owner-kind"),
      scopeOwnerName: values.get("--scope-owner-name"),
    },
  };
  if (command !== "permit") return parsed;
  return {
    ...parsed,
    review: {
      actorKind: "human_operator",
      confirmation: "reviewed_exact_candidate",
      candidateDigest: values.get("--reviewed-candidate-digest"),
      packageSourceSha256: values.get("--reviewed-source-sha256"),
      outputSha256: values.get("--reviewed-output-sha256"),
    },
  };
}
