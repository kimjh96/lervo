# ADR-0174: Bounded Parser-Grade JavaScript and TypeScript Symbol Units

- Status: accepted
- Decision date: 2026-08-23

## Context

Regex declarations missed multiline bodies, decorators, overloads, destructuring, JSX, namespaces, and members and used source-wide hashes.

## Decision

javascript-symbol-v1+babel-parser-7.29.8 pins pure @babel/parser 7.29.8 and parses JS/JSX/MJS/CJS/TS/TSX/MTS/CTS with appropriate modes and decorators.

It extracts module-level functions, classes, interfaces, types, enums, namespaces, variable bindings including destructuring, and named namespace/class/interface/enum members. Simple top-level names retain declaration:<name>; qualified and anonymous-default symbols use escaped symbol:/<scope>/<name>.

Ranges cover complete declarations including export/decorators. Multiple bindings share statement range; overloads/merges with one locator span first start through last end. Versions bind exact symbol bytes, adapter ID, and unit mode; source hash stays separate. UTF-16 AST offsets are converted once through sorted UTF-8 boundaries.

Limits are 16,384 symbols and depth 128. Invalid AST/ranges fail completely. V1 explicitly excludes function locals, computed/dynamic members, CommonJS assignment, import/export references, and cross-file resolution, making no precise-reference/SCIP claim. It runs no code, import, macro, build, filesystem service, shell, or network.

Parser dependencies are bundled into CLI and recorded exactly in release manifest/SBOM. Errors reveal no source/path/identifier/parser detail.

## Consequences

Fixtures cover modern TS/JS syntax, members, namespaces, destructuring, TSX/module modes, UTF-8 ranges, locator continuity, sibling isolation, limits, nonexecution, and built/packed isolated CLI.
