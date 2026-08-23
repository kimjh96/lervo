import {
  prepareIsolatedNpmTrustedPublishingClient,
} from "./npm-trusted-publishing-client.mjs";
import {
  npmPublicRegistry,
  ReleasePublicationAuthorizationError,
} from "./release-publication-authorization.mjs";

const minimumStageNpmVersion = [11, 15, 0];

function fail(code, message) {
  throw new ReleasePublicationAuthorizationError(code, message);
}

export async function prepareNpmTrustedStagePublisher(
  { target, artifact, tarballPath },
  {
    environment = process.env,
    execute,
    npmCommand = "npm",
    nodeVersion = process.version,
  } = {},
) {
  if (
    target?.registry !== npmPublicRegistry || target.package !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(target.version ?? "") ||
    !["latest", "next"].includes(target.distTag) || target.access !== "public" ||
    artifact?.file !== `lervo-cli-${target.version}.tgz` ||
    typeof artifact.sha256 !== "string" || typeof artifact.registryIntegrity !== "string" ||
    typeof artifact.registryShasum !== "string" || typeof tarballPath !== "string" ||
    tarballPath.length === 0
  ) {
    fail(
      "npm_trusted_stage_target_invalid",
      "The npm stage Trusted Publishing target is invalid.",
    );
  }
  const client = await prepareIsolatedNpmTrustedPublishingClient({
    environment,
    ...(execute === undefined ? {} : { execute }),
    minimumNpmVersion: minimumStageNpmVersion,
    npmCommand,
    nodeVersion,
    temporaryPrefix: "lervo-npm-stage-",
  });
  let called = false;
  return {
    async stage() {
      if (called) {
        fail(
          "npm_stage_publication_reuse_forbidden",
          "The same npm stage publisher cannot be invoked again.",
        );
      }
      called = true;
      try {
        await client.execute([
          "stage",
          "publish",
          tarballPath,
          "--registry",
          target.registry,
          "--tag",
          target.distTag,
          "--access",
          target.access,
          "--ignore-scripts",
        ]);
      } catch {
        fail(
          "npm_stage_publication_outcome_unknown",
          "The npm stage publication result could not be verified.",
        );
      }
      return {
        schemaVersion: 1,
        status: "stage_submission_accepted",
        operation: "npm_stage_publish",
        target: structuredClone(target),
        artifact: structuredClone(artifact),
        evidence: "npm_cli_exit_zero",
      };
    },
    dispose: () => client.dispose(),
  };
}
