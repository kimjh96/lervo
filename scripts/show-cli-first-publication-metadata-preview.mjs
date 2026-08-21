import { inspectCliFirstPublicationMetadataPreview } from
  "./lib/cli-first-publication-metadata-preview.mjs";
import { createFirstPublicationMetadataDecision } from
  "./lib/first-publication-metadata-decision.mjs";
import { formatFirstPublicationMetadataPreview } from
  "./lib/first-publication-metadata-preview-formatter.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { ReleaseAttestationVerificationError } from
  "./lib/release-attestation-consumer.mjs";

const valueArguments = [
  "--repository",
  "--license",
  "--scope-owner-kind",
  "--scope-owner-name",
];

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_metadata_preview_arguments_invalid",
    "CLI 최초 게시 metadata 변경 미리보기 명령 인자가 올바르지 않습니다.",
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
    const value = args[index + 1];
    if (
      !valueArguments.includes(name) || values.has(name) ||
      value === undefined || value.startsWith("--")
    ) failArguments();
    values.set(name, value);
    index += 1;
  }
  if (!valueArguments.every((name) => values.has(name))) failArguments();
  return {
    json,
    decisionInput: {
      repository: values.get("--repository"),
      license: values.get("--license"),
      scopeOwnerKind: values.get("--scope-owner-kind"),
      scopeOwnerName: values.get("--scope-owner-name"),
    },
  };
}

try {
  const { json, decisionInput } = parseArguments(process.argv.slice(2));
  const decision = createFirstPublicationMetadataDecision(decisionInput);
  const preview = await inspectCliFirstPublicationMetadataPreview(decision);
  process.stdout.write(json
    ? `${JSON.stringify(preview, null, 2)}\n`
    : formatFirstPublicationMetadataPreview(preview));
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseAttestationVerificationError
  ) console.error(`${error.code}: ${error.message}`);
  else console.error(
    "first_publication_metadata_preview_failed: CLI 최초 게시 metadata 변경 미리보기를 만들지 못했습니다.",
  );
  process.exitCode = 1;
}
