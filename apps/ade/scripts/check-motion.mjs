// The stylesheet check for the ADE motion principles: durations and easings come from the motion
// tokens, only opacity, transform, and control colors move, and keyframes animate only opacity and
// transform (ADE motion, "Verification").
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const MOVING = new Set(["opacity", "transform", "background-color", "border-color", "color"]);
const KEYFRAMED = new Set(["opacity", "transform"]);
const LITERAL_TIME = /(?<![\w-])\d*\.?\d+m?s\b/u;
const LITERAL_EASING = /(?<![\w-])(?:ease(?:-in|-out|-in-out)?|linear|cubic-bezier\(|steps\()/u;

/** The violations in one stylesheet's text. */
export function motionViolations(css, file) {
  const violations = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  for (const match of source.matchAll(
    /(?:^|[;{\s])(transition(?:-[a-z]+)?|animation(?:-[a-z]+)?)\s*:\s*([^;}]+)/gmu,
  )) {
    const [, property, value] = match;
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
