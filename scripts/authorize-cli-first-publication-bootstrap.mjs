import { isAbsolute } from "node:path";

import {
  authorizeCliFirstPublicationBootstrap,
  writeFirstPublicationBootstrapAuthorization,
} from "./lib/cli-first-publication-bootstrap.mjs";
import { FirstPublicationBootstrapError } from "./lib/first-publication-bootstrap.mjs";
import { ReleaseArtifactManifestError } from "./lib/release-artifact-manifest.mjs";
import { ReleasePublicationAuthorizationError } from "./lib/release-publication-authorization.mjs";

function failArguments() {
  throw new FirstPublicationBootstrapError(
    "first_publication_bootstrap_arguments_invalid",
    "The CLI first-publication bootstrap command arguments are invalid.",
  );
}

function parseArguments(args) {
  const values = new Map();
  let online = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--online") {
      if (online) failArguments();
      online = true;
      continue;
    }
    if (
      ![
        "--release-directory",
        "--publication-authorization",
        "--external-evidence",
        "--output",
      ].includes(name) ||
      values.has(name) ||
      index + 1 >= args.length
    )
      failArguments();
    values.set(name, args[index + 1]);
    index += 1;
  }
  const required = [
    "--release-directory",
    "--publication-authorization",
    "--external-evidence",
    "--output",
  ];
  if (!online || required.some((name) => !isAbsolute(values.get(name) ?? ""))) {
    failArguments();
  }
  return {
    options: {
      online,
      releaseDirectory: values.get("--release-directory"),
      publicationAuthorizationPath: values.get("--publication-authorization"),
      externalEvidencePath: values.get("--external-evidence"),
    },
    outputPath: values.get("--output"),
  };
}

try {
  const { options, outputPath } = parseArguments(process.argv.slice(2));
  const bootstrap = await authorizeCliFirstPublicationBootstrap(options);
  await writeFirstPublicationBootstrapAuthorization(outputPath, bootstrap);
  console.log(
    `CLI first-publication bootstrap approval bound (${bootstrap.target.package}@${bootstrap.target.version})`,
  );
} catch (error) {
  if (
    error instanceof FirstPublicationBootstrapError ||
    error instanceof ReleaseArtifactManifestError ||
    error instanceof ReleasePublicationAuthorizationError
  ) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(
      "first_publication_bootstrap_failed: The CLI first-publication bootstrap could not be prepared.",
    );
  }
  process.exitCode = 1;
}
