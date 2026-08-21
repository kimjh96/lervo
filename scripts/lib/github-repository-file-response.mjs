const blobShaPattern = /^[a-f0-9]{40}$/u;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export function normalizeGitHubRepositoryFileResponse(
  response,
  { path, maximumBytes },
) {
  if (
    response?.type !== "file" || response.path !== path ||
    response.encoding !== "base64" || !Number.isSafeInteger(response.size) ||
    response.size < 1 || response.size > maximumBytes ||
    !blobShaPattern.test(response.sha ?? "") || typeof response.content !== "string" ||
    response.content.includes("\r")
  ) return undefined;
  const encoded = response.content.replaceAll("\n", "");
  if (!base64Pattern.test(encoded)) return undefined;
  const contents = Buffer.from(encoded, "base64");
  if (contents.length !== response.size || contents.toString("base64") !== encoded) {
    return undefined;
  }
  return { blobSha: response.sha, contents };
}
