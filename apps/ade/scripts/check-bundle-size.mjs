// The bundle-size check that runs on every pull request (ADE performance, "Size"). It reads the
// built interface in dist/, sums the gzip size of what the start screen loads, and compares it and
// each lazily loaded chunk with its budget.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** Gzip bytes the start screen may load, and any one chunk that loads on first use. */
export const BUDGETS = { initialGzipBytes: 120 * 1024, lazyChunkGzipBytes: 160 * 1024 };

/** The scripts index.html loads, directly or through module preloads. */
function initialScripts(html) {
  return [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.js)"/gu)].map((match) => match[1]);
}

export async function measureBundle(dist) {
  const html = await readFile(join(dist, "index.html"), "utf8");
  const initial = new Set(initialScripts(html));
  const sizes = {};
  for (const name of await readdir(join(dist, "assets"))) {
    if (!name.endsWith(".js")) continue;
    sizes[`assets/${name}`] = gzipSync(await readFile(join(dist, "assets", name))).length;
  }
  const initialGzipBytes = [...initial].reduce((total, name) => total + (sizes[name] ?? 0), 0);
  const lazy = Object.entries(sizes).filter(([name]) => !initial.has(name));
  const largestLazy = lazy.reduce(
    (largest, entry) => (entry[1] > largest[1] ? entry : largest),
    ["", 0],
  );
  return {
    initialGzipBytes,
    largestLazyChunk: largestLazy[0],
    largestLazyGzipBytes: largestLazy[1],
  };
}

export function bundleViolations(measured) {
  const violations = [];
  if (measured.initialGzipBytes > BUDGETS.initialGzipBytes)
    violations.push(
      `the start screen loads ${measured.initialGzipBytes} gzip bytes, over ${BUDGETS.initialGzipBytes}`,
    );
  if (measured.largestLazyGzipBytes > BUDGETS.lazyChunkGzipBytes)
    violations.push(
      `${measured.largestLazyChunk} is ${measured.largestLazyGzipBytes} gzip bytes, over ${BUDGETS.lazyChunkGzipBytes}`,
    );
  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const measured = await measureBundle(join(import.meta.dirname, "..", "dist"));
  const violations = bundleViolations(measured);
  console.log(JSON.stringify(measured));
  if (violations.length > 0) {
    for (const violation of violations) console.error(violation);
    process.exit(1);
  }
}
