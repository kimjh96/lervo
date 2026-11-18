/** Conservative reference extraction also recognizes hashes nested in private subsystem records. */
export function casReferences(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/(?:sha256:|lervo-cas:\/\/sha256\/)([a-f0-9]{64})/gu)].map(
        (match) => match[1]!,
      ),
    ),
  ];
}
