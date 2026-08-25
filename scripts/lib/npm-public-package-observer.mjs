const packageName = "@lervo/cli";
const packageUrl = "https://registry.npmjs.org/%40lervo%2Fcli";

function observation(state, reason) {
  return {
    schemaVersion: 1,
    source: "npm_public_registry",
    state,
    package: packageName,
    ...(reason === undefined ? {} : { reason }),
  };
}

export async function observeNpmPublicPackage({ request = globalThis.fetch } = {}) {
  let response;
  try {
    response = await request(packageUrl, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return observation("unavailable", "registry_unavailable");
  }
  try {
    await response.body?.cancel();
  } catch {
    return observation("unavailable", "registry_unavailable");
  }
  if (response.status === 404) return observation("not_found");
  if (response.ok) return observation("existing");
  return observation("unavailable", "registry_unavailable");
}
