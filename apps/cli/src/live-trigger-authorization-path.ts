export function isDirectLervoAuthorizationJson(relativePath: string): boolean {
  const portablePath = relativePath.replaceAll("\\", "/");
  return /^\.lervo\/[A-Za-z0-9._-]+\.json$/u.test(portablePath);
}
