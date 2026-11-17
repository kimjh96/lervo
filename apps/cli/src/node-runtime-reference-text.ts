export function runtimeReferences(
  text: string,
  root: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const references = new Set<string>();
  if (platform === "darwin") {
    text = text.toLowerCase();
    root = root.toLowerCase();
  }
  // Service files may quote spaces or XML-escape apostrophes in a home directory.
  const decoded = text.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  for (const value of [
    decoded,
    decoded.replaceAll('"', "").replaceAll("'", "").replaceAll("\\", ""),
  ]) {
    const prefix = `${root}/`;
    let start = value.indexOf(prefix);
    while (start >= 0) {
      const name = value.slice(start + prefix.length, start + prefix.length + 16);
      // A path inside the runtime, or the runtime directory itself as a PATH entry or argument.
      const next = value[start + prefix.length + 16];
      if (/^[a-f0-9]{16}$/u.test(name) && (next === undefined || !/[\w.-]/u.test(next)))
        references.add(name);
      start = value.indexOf(prefix, start + prefix.length);
    }
  }
  return [...references];
}
