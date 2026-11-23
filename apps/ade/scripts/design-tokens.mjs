// Turns the DTCG token file into the CSS custom properties, the motion durations, and the sizes
// script needs. Components and themes read only these outputs (ADE design system, "Tokens").

/** Groups that never reach the stylesheet: the primitives. */
const NOT_IN_CSS = new Set(["palette"]);
const ALIAS = /^\{([^}]+)\}$/u;

/** The value of the token at a dotted `path`, with its own aliases resolved. */
function lookup(tokens, path, seen) {
  const token = path.split(".").reduce((group, key) => group?.[key], tokens);
  if (token === undefined || !("$value" in token))
    throw new Error(`Unknown token alias {${path}}.`);
  if (seen.has(path)) throw new Error(`Circular token alias {${path}}.`);
  return resolve(tokens, token.$value, new Set([...seen, path]));
}

/** `value` with every DTCG alias, such as `{palette.blue.600}`, replaced by what it names. */
export function resolve(tokens, value, seen = new Set()) {
  if (typeof value === "string") {
    const alias = ALIAS.exec(value);
    return alias === null ? value : lookup(tokens, alias[1], seen);
  }
  if (Array.isArray(value)) return value.map((item) => resolve(tokens, item, seen));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolve(tokens, item, seen)]),
    );
  return value;
}

function* leaves(group, path = []) {
  for (const [key, value] of Object.entries(group)) {
    if (key.startsWith("$")) continue;
    if (value !== null && typeof value === "object" && "$value" in value)
      yield [[...path, key], value];
    else if (value !== null && typeof value === "object") yield* leaves(value, [...path, key]);
  }
}

const kebab = (part) => part.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
const property = (path) => `--${path.map(kebab).join("-")}`;

function cssValue(token, value) {
  if (token.$type === "fontFamily")
    return value.map((name) => (name.includes(" ") ? `"${name}"` : name)).join(", ");
  if (token.$type === "cubicBezier") return `cubic-bezier(${value.join(", ")})`;
  return String(value);
}

function declarations(tokens, mode) {
  const lines = [];
  for (const [path, token] of leaves(tokens)) {
    if (NOT_IN_CSS.has(path[0])) continue;
    const modes = token.$extensions?.["dev.lervo.modes"];
    if (mode !== null && modes === undefined) continue;
    const raw = mode === null ? (modes ? modes.light : token.$value) : modes[mode];
    const value = resolve(tokens, raw);
    if (token.$type === "typography") {
      lines.push(`  ${property(path)}-size: ${value.fontSize};`);
      lines.push(`  ${property(path)}-weight: ${value.fontWeight};`);
      lines.push(`  ${property(path)}-line-height: ${value.lineHeight};`);
      if (value.letterSpacing !== undefined)
        lines.push(`  ${property(path)}-letter-spacing: ${value.letterSpacing};`);
    } else lines.push(`  ${property(path)}: ${cssValue(token, value)};`);
  }
  return lines.join("\n");
}

const indent = (text) =>
  text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

/** The generated stylesheet: light by default, dark from the OS or `data-theme`. */
export function renderTokenCss(tokens) {
  return `/* Generated from src/design/tokens.json by scripts/build-tokens.mjs. Do not edit. */
:root {
${declarations(tokens, null)}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${indent(declarations(tokens, "dark"))}
  }
}

:root[data-theme="dark"] {
${declarations(tokens, "dark")}
}

/* Reduced motion means no movement; reduced transparency means opaque surfaces. */
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration-change: 0ms;
    --motion-duration-enter: 0ms;
    --motion-duration-exit: 0ms;
  }
}

@media (prefers-reduced-transparency: reduce) {
  :root {
    --glass-tint-opacity: 1;
  }
}

/* Increased contrast: opaque surfaces, secondary text a step darker or lighter, stronger borders. */
@media (prefers-contrast: more) {
  :root {
${indent(contrastDeclarations(tokens, "light"))}
  }
}

@media (prefers-contrast: more) and (prefers-color-scheme: dark) {
  :root {
${indent(contrastDeclarations(tokens, "dark"))}
  }
}

@media (prefers-contrast: more) {
  :root[data-theme="dark"] {
${indent(contrastDeclarations(tokens, "dark"))}
  }
}
`;
}

/** The overrides of tokens that name a value for increased contrast. */
function contrastDeclarations(tokens, mode) {
  const lines = [];
  for (const [path, token] of leaves(tokens)) {
    const contrast = token.$extensions?.["dev.lervo.contrast"];
    if (contrast === undefined) continue;
    lines.push(`  ${property(path)}: ${cssValue(token, resolve(tokens, contrast[mode]))};`);
  }
  return lines.join("\n");
}

/** The motion durations in milliseconds, for motion that script drives, such as streamed text. */
export function renderMotion(tokens) {
  const durations = Object.fromEntries(
    Object.entries(tokens.motion.duration).map(([name, token]) => [
      `${name}Ms`,
      Number.parseFloat(token.$value),
    ]),
  );
  const body = JSON.stringify(durations, null, 2);
  return `// Generated from src/design/tokens.json by scripts/build-tokens.mjs. Do not edit.\nexport const motion = ${body} as const;\n`;
}

/** The sizes script needs, in pixels, such as the icon sizes components pass to an SVG. */
export function renderSizes(tokens) {
  const icon = Object.fromEntries(
    Object.entries(tokens.size.icon)
      .filter(([name]) => !name.startsWith("$"))
      .map(([name, token]) => [name, Number.parseFloat(resolve(tokens, token.$value))]),
  );
  const body = JSON.stringify({ icon }, null, 2);
  return `// Generated from src/design/tokens.json by scripts/build-tokens.mjs. Do not edit.\nexport const sizes = ${body} as const;\n`;
}
