// Turns the DTCG token file into the CSS custom properties and the terminal themes. Components
// and themes read only these outputs (ADE visual language, "Token file").

const MODES = ["light", "dark"];

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
    if (path[0] === "terminal") continue;
    const modes = token.$extensions?.["dev.lervo.modes"];
    if (mode !== null && modes === undefined) continue;
    const value = mode === null ? token.$value : modes[mode];
    if (token.$type === "typography") {
      lines.push(`  ${property(path)}-size: ${value.fontSize};`);
      lines.push(`  ${property(path)}-weight: ${value.fontWeight};`);
      lines.push(`  ${property(path)}-line-height: ${value.lineHeight};`);
    } else
      lines.push(
        `  ${property(path)}: ${cssValue(token, mode === null && modes ? modes.light : value)};`,
      );
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

/** The terminal themes for xterm.js, one per mode. */
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
  return `// Generated from src/design/tokens.json by scripts/build-tokens.mjs. Do not edit.\nexport const terminalThemes = ${body} as const;\n`;
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
