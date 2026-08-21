import {
  npmPublicRegistry,
  ReleasePublicationAuthorizationError,
} from "./release-publication-authorization.mjs";
import {
  prepareIsolatedNpmTrustedPublishingClient,
  validateNpmTrustedPublishingEnvironment,
} from "./npm-trusted-publishing-client.mjs";

const minimumNpmVersion = [11, 5, 1];

function fail(code, message) {
  throw new ReleasePublicationAuthorizationError(code, message);
}

export { validateNpmTrustedPublishingEnvironment };

async function executeJson(client, args) {
  let stdout;
  try {
    ({ stdout } = await client.execute(args));
    return JSON.parse(stdout);
  } catch {
    fail(
      "npm_publication_verification_failed",
      "npm registry 게시 결과를 확인하지 못했습니다.",
    );
  }
}

export function createNpmTrustedPublisher({
  environment = process.env,
  execute,
  npmCommand = "npm",
  nodeVersion = process.version,
} = {}) {
  return async ({ target, artifact, tarballPath }) => {
    if (target.registry !== npmPublicRegistry) {
      fail(
        "npm_trusted_publishing_target_invalid",
        "npm Trusted Publishing 대상이 올바르지 않습니다.",
      );
    }
    const client = await prepareIsolatedNpmTrustedPublishingClient({
      environment,
      ...(execute === undefined ? {} : { execute }),
      minimumNpmVersion,
      npmCommand,
      nodeVersion,
      temporaryPrefix: "lervo-npm-publish-",
    });
    try {
      try {
        await client.execute([
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
          "npm_publication_failed",
          "npm registry 게시를 완료하지 못했습니다.",
        );
      }
      const coordinate = `${target.package}@${target.version}`;
      const [metadata, tags] = await Promise.all([
        executeJson(client, [
          "view",
          coordinate,
          "dist",
          "--registry",
          target.registry,
          "--json",
        ]),
        executeJson(client, [
          "view",
          target.package,
          "dist-tags",
          "--registry",
          target.registry,
          "--json",
        ]),
      ]);
      if (
        metadata?.integrity !== artifact.registryIntegrity ||
        metadata.shasum !== artifact.registryShasum ||
        tags?.[target.distTag] !== target.version
      ) {
        fail(
          "npm_publication_verification_failed",
          "npm registry 게시 결과를 확인하지 못했습니다.",
        );
      }
      return {
        registry: target.registry,
        package: target.package,
        version: target.version,
        distTag: target.distTag,
        registryIntegrity: metadata.integrity,
        registryShasum: metadata.shasum,
      };
    } finally {
      await client.dispose();
    }
  };
}
