// Turns the DTCG token file into the CSS custom properties, the terminal themes, and the sizes
// script needs. Components and themes read only these outputs (ADE design system, "Tokens").

const MODES = ["light", "dark"];
/** Groups that never reach the stylesheet: primitives, and the terminal's own theme. */
const NOT_IN_CSS = new Set(["palette", "terminal"]);
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
`;
}

/** The terminal themes for xterm.js, one per mode, and the terminal's typography. */
export function renderTerminalThemes(tokens) {
  const theme = (mode) =>
    Object.fromEntries(
      [...leaves(tokens.terminal)].map(([path, token]) => [
        path.join(""),
        token.$extensions["dev.lervo.modes"][mode],
      ]),
    );
  const body = JSON.stringify(
    Object.fromEntries(MODES.map((mode) => [mode, theme(mode)])),
    null,
    2,
  );
  const mono = resolve(tokens, tokens.type.mono.$value);
  const font = JSON.stringify(
    {
      fontFamily: cssValue(tokens.font.family.mono, tokens.font.family.mono.$value),
      fontSize: Number.parseFloat(mono.fontSize),
      lineHeight: mono.lineHeight,
    },
    null,
    2,
  );
  return `// Generated from src/design/tokens.json by scripts/build-tokens.mjs. Do not edit.\nexport const terminalThemes = ${body} as const;\n\n/** The CLI conversation's face, size in pixels, and line height, from \`type.mono\`. */\nexport const terminalFont = ${font} as const;\n`;
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
