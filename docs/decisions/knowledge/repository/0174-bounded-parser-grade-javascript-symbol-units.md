# ADR-0174: Bounded Parser-Grade JavaScript and TypeScript Symbol Units

- Status: accepted
- Decision date: 2026-08-23

## Context

Regex-based declaration scanning missed multiline bodies, decorators, overloads, destructuring, JSX, namespaces, and members, and it used source-wide hashes.

## Decision

`javascript-symbol-v1+babel-parser-7.29.8` pins pure `@babel/parser` 7.29.8 and parses JS, JSX, MJS, CJS, TS, TSX, MTS, and CTS using appropriate modes and decorator support.

It extracts module-level functions, classes, interfaces, types, enums, namespaces, variable bindings including destructuring, and named namespace, class, interface, and enum members. Simple top-level names retain `declaration:<name>`; qualified and anonymous-default symbols use escaped `symbol:/<scope>/<name>` locators.

Ranges cover complete declarations, including exports and decorators. Multiple bindings share their statement range. Overloads or merged declarations with one locator span from the first start through the last end. Versions bind exact symbol bytes, adapter ID, and unit mode; the source hash remains separate. UTF-16 AST offsets are converted once through sorted UTF-8 boundaries.

Limits are 16,384 symbols and depth 128. Invalid ASTs or ranges fail completely. V1 explicitly excludes function locals, computed or dynamic members, CommonJS assignment, import/export references, and cross-file resolution; it makes no precise-reference or SCIP claim. It runs no code, imports, macros, builds, filesystem services, shell commands, or network operations.

Parser dependencies are bundled into the CLI and recorded exactly in the release manifest and SBOM. Errors reveal no source, path, identifier, or parser details.

## Consequences

Fixtures cover modern TS and JS syntax, members, namespaces, destructuring, TSX and module modes, UTF-8 ranges, locator continuity, sibling isolation, limits, nonexecution, and built and packed isolated CLI behavior.

## Amendment (2026-10-31)

TypeScript declaration files (`.d.ts`, `.d.mts`, and `.d.cts`) are parsed as declarations. An ambient `export const X: T;` has no initializer, so parsing it as an implementation file failed. In `axli`, two such files failed `lervo knowledge lint` for the whole repository. Implementation files keep their strict parsing.
