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
    "CLI 최초 게시 bootstrap 명령 인자가 올바르지 않습니다.",
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
    if (![
      "--release-directory",
      "--publication-authorization",
      "--approval",
      "--output",
    ].includes(name) || values.has(name) || index + 1 >= args.length) failArguments();
    values.set(name, args[index + 1]);
    index += 1;
  }
  const required = [
    "--release-directory",
    "--publication-authorization",
    "--approval",
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
      approvalPath: values.get("--approval"),
    },
    outputPath: values.get("--output"),
  };
}

try {
  const { options, outputPath } = parseArguments(process.argv.slice(2));
  const bootstrap = await authorizeCliFirstPublicationBootstrap(options);
  await writeFirstPublicationBootstrapAuthorization(outputPath, bootstrap);
  console.log(
    `CLI 최초 게시 bootstrap 승인 결속 완료 (${bootstrap.target.package}@${bootstrap.target.version})`,
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
      "first_publication_bootstrap_failed: CLI 최초 게시 bootstrap을 준비하지 못했습니다.",
    );
  }
  process.exitCode = 1;
}
