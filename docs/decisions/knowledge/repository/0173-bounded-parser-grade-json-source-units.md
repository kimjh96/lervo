# ADR-0173: Bounded Parser-Grade JSON Source Units

- Status: accepted
- Decision date: 2026-08-23

## Context

The previous `JSON.parse` adapter reused whole-file ranges and hashes, missed objects inside arrays, and silently fell back after parse errors. Consequently, locators and snippets diverged, and sibling changes invalidated every key.

## Decision

`json-key-pointer-v1+jsonc-parser-3.3.1` pins Microsoft's parser but accepts only strict `.json`. Comments, trailing commas, empty input, and any parser error fail; `.jsonc` retains file-only coverage. Packaging uses the declared CommonJS main for direct Node imports and statically bundles the ESM tree into the CLI, preserving one adapter contract.

Each AST property becomes `json-pointer:<RFC-6901-pointer>`, recursively across objects and arrays. Exact bytes span from the property key through the value end. Parent subtrees react to child changes while siblings remain isolated. Stable IDs and locators remain unchanged; versions bind exact property bytes, adapter ID, and unit mode. One migration change links through the stable ID.

Duplicate decoded keys, including differently escaped spellings, fail. Limits are 16,384 properties and depth 128. The adapter traverses only the AST and never assigns values or executes repository code or actions.

Failures are complete and redact paths, bytes, property names, parser output, and secrets.

## Consequences

Fixtures cover nested objects, objects in arrays, escaping, ranges, sibling isolation, duplicate encodings, invalid strict JSON, limits, and both direct-package and bundled CLI behavior.
