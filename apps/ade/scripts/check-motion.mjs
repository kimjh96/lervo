// The stylesheet check for the ADE motion principles: durations and easings come from the motion
// tokens, only opacity, transform, and control colors move, and keyframes animate only opacity,
// transform, and the working line's background position (ADE motion, "Verification").
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const MOVING = new Set(["opacity", "transform", "background-color", "border-color", "color"]);
// The working line's highlight moves across its text with `background-position`; it repaints
// only that line while an agent works (ADE motion, "Working status").
const KEYFRAMED = new Set(["opacity", "transform", "background-position"]);
const LITERAL_TIME = /(?<![\w-])\d*\.?\d+m?s\b/u;
const LITERAL_EASING = /(?<![\w-])(?:ease(?:-in|-out|-in-out)?|linear|cubic-bezier\(|steps\()/u;

/**
 * Nothing appears or leaves in a frame (ADE motion, principle 11): every arrival runs over `enter`
 * and every leaving over `leave`, both on the fade easing, which starts and ends slowly, so no
 * fade pops in during its first frames or drops out in its last.
 */
const ARRIVALS = /\blervo-(?:appear|arrive)\b/u;
const LEAVINGS = /\blervo-leave\b/u;

function fadeViolations(property, value, file) {
  if (property !== "animation") return [];
  const easing = value.includes("--motion-easing-fade");
  if (ARRIVALS.test(value) && (!value.includes("--motion-duration-enter") || !easing))
    return [`${file}: an arrival runs over something other than enter on the fade easing`];
  if (LEAVINGS.test(value) && (!value.includes("--motion-duration-leave") || !easing))
    return [`${file}: a leaving runs over something other than leave on the fade easing`];
  return [];
}

/** The violations in one stylesheet's text. */
export function motionViolations(css, file) {
  const violations = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  for (const match of source.matchAll(
    /(?:^|[;{\s])(transition(?:-[a-z]+)?|animation(?:-[a-z]+)?)\s*:\s*([^;}]+)/gmu,
  )) {
    const [, property, value] = match;
    violations.push(...fadeViolations(property, value, file));
    const plain = value.replaceAll(/var\([^)]*\)/gu, "");
    if (LITERAL_TIME.test(plain))
      violations.push(`${file}: ${property} uses a duration that is not a motion token`);
    if (LITERAL_EASING.test(plain))
      violations.push(`${file}: ${property} uses an easing that is not a motion token`);
    if (property === "transition" || property === "transition-property") {
      for (const part of plain.split(",")) {
        const name = part.trim().split(/\s+/u)[0];
        if (name === "none" || name === undefined || name.length === 0) continue;
        if (!MOVING.has(name)) violations.push(`${file}: transition moves ${name}`);
      }
    }
  }
  for (const match of source.matchAll(
    /@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/gu,
  )) {
    const [, name, body] = match;
    for (const declaration of body.matchAll(/([a-z-]+)\s*:/gu)) {
      if (!KEYFRAMED.has(declaration[1]))
        violations.push(`${file}: @keyframes ${name} animates ${declaration[1]}`);
    }
  }
  return violations;
}

async function* stylesheets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* stylesheets(path);
    else if (entry.name.endsWith(".css") && !path.includes("/generated/")) yield path;
  }
}

/** Every violation in the interface's stylesheets. */
export async function checkMotion(root) {
  const violations = [];
  for await (const path of stylesheets(join(root, "src")))
    violations.push(...motionViolations(await readFile(path, "utf8"), relative(root, path)));
  return violations;
}
