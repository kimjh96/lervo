import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

const valueArguments = [
  "--repository",
  "--license",
  "--scope-owner-kind",
  "--scope-owner-name",
];

const commandErrors = {
  preview: {
    code: "first_publication_metadata_preview_arguments_invalid",
    message: "CLI 최초 게시 metadata 변경 미리보기 명령 인자가 올바르지 않습니다.",
  },
  candidate: {
    code: "first_publication_package_metadata_candidate_arguments_invalid",
    message: "CLI 최초 게시 package metadata 후보 명령 인자가 올바르지 않습니다.",
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
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--json" || name === "--package-json") {
      if (output !== "human" || (name === "--package-json" && command !== "candidate")) {
        fail(command);
      }
      output = name === "--json" ? "json" : "package_json";
      continue;
    }
    const value = args[index + 1];
    if (
      !valueArguments.includes(name) || values.has(name) ||
      value === undefined || value.startsWith("--")
    ) fail(command);
    values.set(name, value);
    index += 1;
  }
  if (!valueArguments.every((name) => values.has(name))) fail(command);
  return {
    output,
    decisionInput: {
      repository: values.get("--repository"),
      license: values.get("--license"),
      scopeOwnerKind: values.get("--scope-owner-kind"),
      scopeOwnerName: values.get("--scope-owner-name"),
    },
  };
}
