// The stylesheet and component check for the design system's value rule: every color, size,
// radius, type value, weight, opacity, and offset in a component comes from a token (ADE design
// system, "Rules for values"). Allowed without a token: 0, 1px hairlines, 100% and 0%, auto,
// transparent, currentColor, alpha-only mask colors, and the collapse breakpoint in a media
// query, which CSS cannot read from a custom property.
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab)\(/iu;
const LENGTH = /(?<![\w.])(-?\d*\.?\d+)(px|em|rem)\b/gu;
const SIZING = /^(?:width|height|min-width|min-height|max-width|max-height|flex-basis)$/u;
const PERCENT = /(?<![\w.-])(\d*\.?\d+)%/gu;
const NUMERIC =
  /^(?:font-size|line-height|font-weight|letter-spacing|opacity|z-index|border-radius)$/u;
const MASK = /^(?:mask|mask-image|-webkit-mask|-webkit-mask-image)$/u;

/** The violations in one stylesheet's text; `breakpoints` are the media query lengths allowed. */
export function stylesheetViolations(css, file, breakpoints) {
  const violations = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  for (const media of source.matchAll(/@media([^{]*)\{/gu))
    for (const [length] of media[1].matchAll(LENGTH))
      if (!breakpoints.has(length))
        violations.push(`${file}: @media uses ${length}, which is not a layout breakpoint`);
  const inKeyframes = new Set();
  for (const keyframes of source.matchAll(/@keyframes[^{]*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/gu))
    inKeyframes.add(keyframes[1]);
  for (const match of source.matchAll(/(?:^|[;{\s])(-?-?[a-z-]+)\s*:\s*([^;{}]+)/gmu)) {
    const [, property, value] = match;
    if (property.startsWith("--")) continue;
    const plain = value.replaceAll(/var\([^)]*\)/gu, "").trim();
    const keyframed = [...inKeyframes].some((body) => body.includes(match[0].trim()));
    if (COLOR.test(plain) && !(MASK.test(property) && /#000\b|black/u.test(plain)))
      violations.push(`${file}: ${property} uses a literal color`);
    for (const [length, number] of plain.matchAll(LENGTH))
      if (!(Number.parseFloat(number) === 0 || length === "1px"))
        violations.push(`${file}: ${property} uses ${length}, which is not a token`);
    if (SIZING.test(property))
      for (const [percent, number] of plain.matchAll(PERCENT))
        if (Number.parseFloat(number) !== 100 && Number.parseFloat(number) !== 0)
          violations.push(`${file}: ${property} uses ${percent}, which is not a token`);
    if (
      NUMERIC.test(property) &&
      /^-?\d*\.?\d+$/u.test(plain) &&
      !(keyframed && /^[01]$/u.test(plain))
    )
      if (!(property === "line-height" && plain === "1"))
        violations.push(`${file}: ${property} uses ${plain}, which is not a token`);
  }
  return violations;
}

/** The violations in one component's source: icon and other sizes passed as numbers. */
export function componentViolations(source, file) {
  return [...source.matchAll(/\bsize=\{\s*\d/gu)].map(
    () => `${file}: a size is passed as a number instead of a token`,
  );
}

async function* files(directory, extension) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "generated") yield* files(path, extension);
    } else if (extension.test(entry.name)) yield path;
  }
}

/** Every violation in the interface's and the catalog's stylesheets and components. */
export async function checkLiterals(root) {
  const tokens = JSON.parse(await readFile(join(root, "src/design/tokens.json"), "utf8"));
  const breakpoints = new Set([tokens.layout.collapseBelow.$value]);
  const violations = [];
  for (const directory of ["src", "catalog"]) {
    for await (const path of files(join(root, directory), /\.css$/u))
      violations.push(
        ...stylesheetViolations(await readFile(path, "utf8"), relative(root, path), breakpoints),
      );
    for await (const path of files(join(root, directory), /\.tsx$/u))
      violations.push(...componentViolations(await readFile(path, "utf8"), relative(root, path)));
  }
  return violations;
}
