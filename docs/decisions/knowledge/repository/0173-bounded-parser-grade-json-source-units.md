# ADR-0173: Bounded Parser-Grade JSON Source Units

- Status: accepted
- Decision date: 2026-08-23

## Context

The prior JSON.parse adapter reused whole-file ranges/hashes, missed objects inside arrays, and silently fell back on parse errors, so locators and snippets did not match and sibling changes invalidated every key.

## Decision

json-key-pointer-v1+jsonc-parser-3.3.1 pins Microsoft's parser but accepts strict .json only. Comments, trailing commas, empty input, and any parser error fail; .jsonc retains file-only coverage. Packaging uses the declared CommonJS main for direct Node imports and statically bundles the ESM tree in CLI, preserving one adapter contract.

Each AST property becomes json-pointer:<RFC-6901-pointer>, recursively through objects and arrays. Exact bytes span property key through value end. Parent subtrees react to child changes; siblings remain isolated. Stable IDs/locators remain, while versions bind exact property bytes, adapter ID, and unit mode; one migration change links through stable ID.

Duplicate decoded keys—including differently escaped spellings—fail. Limits are 16,384 properties and depth 128. The adapter traverses AST only and never assigns values or executes repository code/actions.

Failures are complete and redact paths, bytes, property names, parser output, and secrets.

## Consequences

Fixtures cover nested/array objects, escaping, ranges, sibling isolation, duplicate encodings, invalid strict JSON, limits, and both direct-package and bundled CLI behavior.
