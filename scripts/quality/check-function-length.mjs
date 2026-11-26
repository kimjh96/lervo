// A decrease-only ratchet on long functions (convention audit, item 15). The 400-line module review
// keeps files cohesive; it does not see one function that holds a module's whole flow. A named
// function longer than the limit fails unless the baseline lists it, and a listed one may only
// shrink. The baseline names each function by its path and name, so moving code keeps its entry.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { productionSources } from "./check-code-convention.mjs";

export const FUNCTION_LINE_LIMIT = 150;
const BASELINE = "scripts/quality/function-length-baseline.json";
const scripted = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

function functionName(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name !== undefined)
    return node.name.getText();
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    node.parent !== undefined &&
    (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) &&
    node.parent.initializer === node
  )
    return node.parent.name.getText();
  return null;
}

/** Every named function of `content` with its line count, keyed `path:Owner.name`. */
export function measureFunctions(path, content) {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const lengths = new Map();
  const visit = (node, owners) => {
    const name = functionName(node);
    let next = owners;
    if (name !== null && node.body !== undefined) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      const end = source.getLineAndCharacterOfPosition(node.end).line;
      const base = `${path}:${[...owners, name].join(".")}`;
      let key = base;
      for (let index = 2; lengths.has(key); index += 1) key = `${base}#${index}`;
      lengths.set(key, end - start + 1);
      next = [...owners, name];
    } else if (ts.isClassDeclaration(node) && node.name !== undefined) {
      next = [...owners, node.name.getText()];
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(source, []);
  return lengths;
}

export async function inspectFunctionLengths(input) {
  const root = input.root;
  const baseline = JSON.parse(await readFile(resolve(root, BASELINE), "utf8")).functions;
  const long = new Map();
  for (const path of await productionSources(root)) {
    if (!scripted.has(path.slice(path.lastIndexOf(".")))) continue;
    const content = await readFile(resolve(root, path), "utf8");
    for (const [key, lines] of measureFunctions(path, content))
      if (lines > FUNCTION_LINE_LIMIT) long.set(key, lines);
  }
  const failures = [];
  for (const [key, lines] of long) {
    const allowed = baseline[key];
    if (allowed === undefined)
      failures.push(`${key} is ${lines} lines, above ${FUNCTION_LINE_LIMIT}; split it.`);
    else if (lines > allowed)
      failures.push(`${key} grew from ${allowed} to ${lines} lines; split it instead.`);
  }
  for (const [key, allowed] of Object.entries(baseline))
    if ((long.get(key) ?? 0) < allowed)
      failures.push(
        `${key} is no longer ${allowed} lines: lower or remove its baseline entry (--write).`,
      );
  return { failures, long };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  if (process.argv.includes("--write")) {
    const long = new Map();
    for (const path of await productionSources(root)) {
      if (!scripted.has(path.slice(path.lastIndexOf(".")))) continue;
      for (const [key, lines] of measureFunctions(
        path,
        await readFile(resolve(root, path), "utf8"),
      ))
        if (lines > FUNCTION_LINE_LIMIT) long.set(key, lines);
    }
    const functions = Object.fromEntries(
      [...long].sort(([left], [right]) => left.localeCompare(right)),
    );
    await writeFile(
      resolve(root, BASELINE),
      `${JSON.stringify({ schemaVersion: 1, limit: FUNCTION_LINE_LIMIT, functions }, null, 2)}\n`,
    );
    console.log(
      `Function length baseline written (${long.size} functions above ${FUNCTION_LINE_LIMIT} lines).`,
    );
    return;
  }
  const { failures, long } = await inspectFunctionLengths({ root });
  if (failures.length > 0) {
    console.error(`Function length ratchet failed (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Function length ratchet passed (${long.size} baseline functions above ${FUNCTION_LINE_LIMIT} lines).`,
  );
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await main();
