export const structuralPublicationHeader = "<!-- lervo:generated repository-knowledge-v1 -->";

/**
 * A structural publication page under the configured publication root is a
 * rebuildable projection while its first line is still the Lervo generated
 * header. Removing that header transfers ownership to the user, so such
 * bytes are never replaced automatically.
 */
export function isRegeneratableStructuralPublication(input: {
  path: string;
  publicationRoot: string;
  currentContent: Uint8Array;
  desiredContent: string;
}): boolean {
  const root = input.publicationRoot.replace(/^\.\//u, "").replace(/\/+$/u, "");
  const headerLine = `${structuralPublicationHeader}\n`;
  return (
    root.length > 0 &&
    input.path.startsWith(`${root}/`) &&
    input.path.endsWith(".md") &&
    input.desiredContent.startsWith(headerLine) &&
    Buffer.from(input.currentContent.subarray(0, Buffer.byteLength(headerLine))).toString(
      "utf8",
    ) === headerLine
  );
}
